// RptBridge — the real print engine behind RPT_BRIDGE_URL. A small .NET Framework exe that opens the ORIGINAL Crystal
// .rpt files with the SAP Crystal Reports runtime and answers the backend's print jobs over HTTP:
//
//   GET  /health   -> {"ok":true,"renderer":"crystal",...}
//   POST /render   -> application/pdf          (rpt_path, selection_formula, formula_values, record_id)
//   POST /print    -> {"message":"sent"}       (same + printer_name, copies)
//   GET  /inspect?rpt=<file>  -> parameters / formula fields / database fields / sub-reports / text labels
//
// Security: listens on 127.0.0.1 ONLY and every request must carry the shared key in X-Rpt-Bridge-Key
// (--key or the RPT_BRIDGE_KEY environment variable). It refuses to start without a key.
//
// What it does for a job mirrors the legacy frmUtlReportViewer: Load(.rpt) -> database logon on every table (and
// sub-report) -> RecordSelectionFormula -> SetParameterValue -> ExportToStream(PDF) or PrintToPrinter.
// The report is 32-bit: build as x86 (see build.cmd / RptBridge.csproj).
using System;
using System.Collections.Generic;
using System.Drawing.Printing;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using CrystalDecisions.CrystalReports.Engine;
using CrystalDecisions.Shared;

namespace RptBridge
{
    internal static class Program
    {
        private const string KeyHeader = "X-Rpt-Bridge-Key";
        private const int MaxBodyBytes = 4 * 1024 * 1024;

        private static readonly object RenderLock = new object(); // the Crystal engine is not thread-safe
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        private static string _server, _db, _user, _password, _rptRoot, _key;
        private static string _previewPrinter = "Microsoft Print to PDF"; // page layout source for PDF previews (--preview-printer)
        private static bool _useOdbc; // legacy gblnUseODBCinCrystal: the "server" is then the DSN, named like the database

        private sealed class HttpError : Exception
        {
            public readonly int Code;
            public HttpError(int code, string message) : base(message) { Code = code; }
        }

        private static int Main(string[] args)
        {
            int port = 8100;
            string settings = null, envFile = null;
            _key = Environment.GetEnvironmentVariable("RPT_BRIDGE_KEY");
            for (int i = 0; i < args.Length; i++)
            {
                string next = i + 1 < args.Length ? args[i + 1] : null;
                if (args[i] == "--odbc") _useOdbc = true;
                else if (next == null) continue;
                else if (args[i] == "--port") port = int.Parse(next);
                else if (args[i] == "--preview-printer") _previewPrinter = next;
                else if (args[i] == "--key") _key = next;
                else if (args[i] == "--settings") settings = next;
                else if (args[i] == "--env") envFile = next;
                else if (args[i] == "--rpts") _rptRoot = next;
            }
            if (string.IsNullOrEmpty(_key)) { Console.Error.WriteLine("Refusing to start without a key (--key or RPT_BRIDGE_KEY)."); return 2; }
            if (!LoadDbSettings(settings, envFile)) { Console.Error.WriteLine("No DB settings (--settings <runtime_db_settings.json> and/or --env <.env>)."); return 2; }
            if (_rptRoot == null) _rptRoot = AppDomain.CurrentDomain.BaseDirectory;

            var listener = new HttpListener();
            listener.Prefixes.Add("http://127.0.0.1:" + port + "/"); // loopback only
            try { listener.Start(); }
            catch (Exception ex) { Console.Error.WriteLine("Cannot listen on 127.0.0.1:" + port + ": " + ex.Message); return 3; }
            Console.WriteLine("RptBridge on http://127.0.0.1:" + port + "  DB=" + _server + "/" + _db + "  RPTS=" + _rptRoot);

            while (true)
            {
                HttpListenerContext ctx = listener.GetContext();
                try { Handle(ctx); }
                catch (HttpError he) { Fail(ctx, he.Code, he.Message); }
                catch (Exception ex) { Fail(ctx, 500, ex.GetBaseException().Message); }
            }
        }

        // ---- settings (secrets stay in the backend's .env / runtime_db_settings.json, never on the command line) ------

        private static bool LoadDbSettings(string settingsJson, string envFile)
        {
            var env = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (envFile != null && File.Exists(envFile))
                foreach (string line in File.ReadAllLines(envFile))
                {
                    if (line.TrimStart().StartsWith("#")) continue;
                    Match m = Regex.Match(line, @"^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$");
                    if (m.Success) env[m.Groups[1].Value] = m.Groups[2].Value;
                }
            _server = Get(env, "DB_SERVER"); _db = Get(env, "DB_NAME"); _user = Get(env, "DB_USER"); _password = Get(env, "DB_PASSWORD");
            string port = Get(env, "DB_PORT");
            if (settingsJson != null && File.Exists(settingsJson)) // the runtime override wins, like the backend
            {
                var d = (Dictionary<string, object>)Json.DeserializeObject(File.ReadAllText(settingsJson));
                Func<string, string> g = k => d.ContainsKey(k) && d[k] != null ? Convert.ToString(d[k]) : null;
                if (!string.IsNullOrEmpty(g("db_server"))) _server = g("db_server");
                if (!string.IsNullOrEmpty(g("db_name"))) _db = g("db_name");
                if (!string.IsNullOrEmpty(g("db_user"))) _user = g("db_user");
                if (g("db_password") != null) _password = g("db_password");
                port = g("db_port") ?? port;
            }
            if (!string.IsNullOrEmpty(port) && _server != null && !_server.Contains(",")) _server += "," + port;
            return !string.IsNullOrEmpty(_server) && !string.IsNullOrEmpty(_db);
        }

        private static string Get(Dictionary<string, string> d, string k) { string v; return d.TryGetValue(k, out v) ? v : null; }

        // ---- HTTP -----------------------------------------------------------------------------------------------

        private static bool KeyOk(string supplied)
        {
            if (supplied == null || supplied.Length != _key.Length) return false;
            int diff = 0; // constant-time compare
            for (int i = 0; i < _key.Length; i++) diff |= supplied[i] ^ _key[i];
            return diff == 0;
        }

        private static void Handle(HttpListenerContext ctx)
        {
            if (!KeyOk(ctx.Request.Headers[KeyHeader])) throw new HttpError(401, "Missing or wrong " + KeyHeader);
            string path = ctx.Request.Url.AbsolutePath.TrimEnd('/');

            if (path == "/health" && ctx.Request.HttpMethod == "GET")
            {
                Send(ctx, 200, "application/json", Json.Serialize(new Dictionary<string, object> { { "ok", true }, { "renderer", "crystal" }, { "db", _server + "/" + _db } }));
                return;
            }
            if (path == "/inspect" && ctx.Request.HttpMethod == "GET")
            {
                Inspect(ctx, ctx.Request.QueryString["rpt"] ?? "");
                return;
            }
            if (ctx.Request.HttpMethod != "POST" || (path != "/render" && path != "/print")) throw new HttpError(404, "Not found");

            var req = ReadJson(ctx);
            string rpt = Str(req, "rpt_path");
            if (rpt.Length == 0) throw new HttpError(400, "rpt_path is required");
            string formula = Str(req, "selection_formula");
            var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (req.ContainsKey("formula_values") && req["formula_values"] is Dictionary<string, object>)
                foreach (var kv in (Dictionary<string, object>)req["formula_values"]) values[kv.Key] = Convert.ToString(kv.Value);


            string printer = null; int copies = 1;
            if (path == "/print")
            {
                printer = Str(req, "printer_name").Trim();
                if (printer.Length == 0) throw new HttpError(400, "printer_name is required");
                if (!PrinterExists(printer)) throw new HttpError(422, "Invalid printer specified: '" + printer + "' is not installed on this PC");
                copies = req.ContainsKey("copies") ? Math.Max(1, (int)Convert.ToDouble(req["copies"])) : 1;
            }

            lock (RenderLock)
            {
                using (ReportDocument doc = Open(rpt, formula, values))
                {
                    if (path == "/render")
                    {
                        UsePreviewPrinter(doc);
                        using (Stream s = doc.ExportToStream(ExportFormatType.PortableDocFormat))
                        {
                            var ms = new MemoryStream();
                            s.CopyTo(ms);
                            foreach (var kv in PaperFacts(doc)) ctx.Response.AddHeader(kv.Key, kv.Value);
                            Send(ctx, 200, "application/pdf", ms.ToArray());
                        }
                    }
                    else
                    {
                        doc.PrintOptions.PrinterName = printer;
                        doc.PrintToPrinter(copies, false, 0, 0);
                        Send(ctx, 200, "application/json", "{\"message\":\"sent\"}");
                    }
                }
            }
        }

        private static Dictionary<string, object> ReadJson(HttpListenerContext ctx)
        {
            if (ctx.Request.ContentLength64 > MaxBodyBytes) throw new HttpError(413, "Request too large");
            string body;
            using (var r = new StreamReader(ctx.Request.InputStream, Encoding.UTF8)) body = r.ReadToEnd();
            try { return (Dictionary<string, object>)Json.DeserializeObject(body); }
            catch { throw new HttpError(400, "Body must be a JSON object"); }
        }

        private static string Str(Dictionary<string, object> d, string k) { return d.ContainsKey(k) && d[k] != null ? Convert.ToString(d[k]) : ""; }

        private static bool PrinterExists(string name)
        {
            foreach (string p in PrinterSettings.InstalledPrinters)
                if (string.Equals(p, name, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        private static void Send(HttpListenerContext ctx, int code, string type, string text) { Send(ctx, code, type, Encoding.UTF8.GetBytes(text)); }

        private static void Send(HttpListenerContext ctx, int code, string type, byte[] data)
        {
            ctx.Response.StatusCode = code;
            ctx.Response.ContentType = type;
            ctx.Response.ContentLength64 = data.Length;
            ctx.Response.OutputStream.Write(data, 0, data.Length);
            ctx.Response.OutputStream.Close();
        }

        private static void Fail(HttpListenerContext ctx, int code, string message)
        {
            Console.Error.WriteLine("[" + code + "] " + message); // never logs the key or the DB password
            try { Send(ctx, code, "application/json", Json.Serialize(new Dictionary<string, string> { { "detail", message } })); } catch { }
        }

        // ---- Crystal --------------------------------------------------------------------------------------------

        private static string ResolveRpt(string rptPath)
        {
            string full = Path.IsPathRooted(rptPath) ? rptPath : Path.Combine(_rptRoot, rptPath);
            if (!full.EndsWith(".rpt", StringComparison.OrdinalIgnoreCase)) full += ".rpt";
            // the backend may send a path from ITS machine; on this PC the same file lives in the bridge's own Rpts folder
            if (!File.Exists(full)) full = Path.Combine(_rptRoot, Path.GetFileName(full));
            if (!File.Exists(full)) throw new HttpError(404, "Report file not found: " + Path.GetFileName(full));
            return full;
        }

        private static ReportDocument Open(string rptPath, string selectionFormula, Dictionary<string, string> values)
        {
            var doc = new ReportDocument();
            try
            {
                doc.Load(ResolveRpt(rptPath));
                PinPaper(doc);
                Logon(doc);
                foreach (ReportDocument sub in doc.Subreports) Logon(sub);
                SetParameters(doc, values);
                if (!string.IsNullOrEmpty(selectionFormula)) doc.RecordSelectionFormula = selectionFormula;
                return doc;
            }
            catch { doc.Dispose(); throw; }
        }

        // Crystal sizes the pages from the DEFAULT PRINTER of the PC it runs on unless told otherwise (an 80mm thermal default would
        // squeeze an A4 report into 72mm). Re-assigning the report's own saved paper size/orientation pins it.
        private static void PinPaper(ReportDocument doc)
        {
            try
            {
                CrystalDecisions.Shared.PaperSize size = doc.PrintOptions.PaperSize;
                PaperOrientation orientation = doc.PrintOptions.PaperOrientation;
                doc.PrintOptions.PaperSize = size;
                doc.PrintOptions.PaperOrientation = orientation;
            }
            catch { /* custom paper: left as the report defines it */ }
        }

        // The default printer of the PC (often an 80mm thermal) would otherwise size every page. A previews-only printer with normal
        // paper (Microsoft Print to PDF) gives the report its own paper; missing printer -> left as is.
        private static void UsePreviewPrinter(ReportDocument doc)
        {
            if (string.IsNullOrEmpty(_previewPrinter) || !PrinterExists(_previewPrinter)) return;
            // only for named paper sizes (A4, Letter...); a custom roll size (e.g. the 3-inch receipts) is not a size the PDF printer knows
            if (!Enum.IsDefined(typeof(CrystalDecisions.Shared.PaperSize), doc.PrintOptions.PaperSize)) return;
            try { doc.PrintOptions.PrinterName = _previewPrinter; } catch { }
        }

        // What the report itself says about its page. "Custom" = a paper size Windows has no name for (the 3-inch roll receipts);
        // the backend trims such pages to the end of the content. Nothing here changes the report.
        private static Dictionary<string, string> PaperFacts(ReportDocument doc)
        {
            var facts = new Dictionary<string, string>();
            bool named = Enum.IsDefined(typeof(CrystalDecisions.Shared.PaperSize), doc.PrintOptions.PaperSize);
            facts["X-Paper-Kind"] = named ? "Named" : "Custom";
            facts["X-Paper-Name"] = doc.PrintOptions.PaperSize.ToString();
            facts["X-Orientation"] = doc.PrintOptions.PaperOrientation.ToString();
            double bottom = 0;
            try { bottom = doc.PrintOptions.PageMargins.bottomMargin / 20.0; } catch { } // twips -> points
            facts["X-Margin-Bottom-Pt"] = bottom.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture);
            try
            {
                var pm = doc.PrintOptions.PageMargins;
                Func<double, string> pt = v => (v / 20.0).ToString("0.##", System.Globalization.CultureInfo.InvariantCulture); // twips -> points
                facts["X-Margins-Pt"] = pt(pm.leftMargin) + "," + pt(pm.topMargin) + "," + pt(pm.rightMargin) + "," + pt(bottom * 20.0);
                facts["X-Content-Size-Pt"] = pt(doc.PrintOptions.PageContentWidth) + "x" + pt(doc.PrintOptions.PageContentHeight);
            }
            catch { }
            return facts;
        }

        // Legacy: ServerName = server (or the DB/DSN name when gblnUseODBCinCrystal), DatabaseName = DB, then ApplyLogOnInfo on every table.
        private static void Logon(ReportDocument doc)
        {
            foreach (CrystalDecisions.CrystalReports.Engine.Table t in doc.Database.Tables)
            {
                TableLogOnInfo info = t.LogOnInfo;
                info.ConnectionInfo.ServerName = _useOdbc ? _db : _server;
                info.ConnectionInfo.DatabaseName = _db;
                info.ConnectionInfo.UserID = _user;
                info.ConnectionInfo.Password = _password;
                info.ConnectionInfo.IntegratedSecurity = false;
                t.ApplyLogOnInfo(info);
            }
        }

        // The shop details are Crystal PARAMETER fields, matched by name (case-insensitive). Names the report does not define
        // are skipped; a defined parameter nobody supplied gets "" / 0 so a headless export cannot stop on a prompt.
        // Sub-report parameters (ReportName set; often linked to the main report) are Crystal's to fill.
        private static void SetParameters(ReportDocument doc, Dictionary<string, string> values)
        {
            foreach (ParameterField pf in doc.ParameterFields)
            {
                if (!string.IsNullOrEmpty(pf.ReportName)) continue;
                string v;
                bool supplied = values.TryGetValue(pf.Name, out v);
                object val;
                if (pf.ParameterValueType == ParameterValueKind.NumberParameter)
                {
                    double n; val = supplied && double.TryParse(v, out n) ? n : 0d;
                }
                else val = supplied ? v : "";
                try { doc.SetParameterValue(pf.Name, val); } catch { /* not settable here */ }
            }
        }

        // ---- /inspect (catalog of a report: used to build docs/legacy-analysis/rpt-catalog.md) --------------------

        private static void Inspect(HttpListenerContext ctx, string rpt)
        {
            lock (RenderLock)
            {
                using (ReportDocument d = Open(rpt, "", new Dictionary<string, string>()))
                {
                    var info = new Dictionary<string, object>();
                    var ps = new List<string>(); foreach (ParameterField pf in d.ParameterFields) ps.Add(pf.Name + "|" + pf.ParameterValueType + "|" + (pf.ReportName ?? ""));
                    var fs = new List<string>(); foreach (FormulaFieldDefinition ff in d.DataDefinition.FormulaFields) fs.Add(ff.Name);
                    var ts = new List<object>();
                    foreach (CrystalDecisions.CrystalReports.Engine.Table t in d.Database.Tables)
                    {
                        var cols = new List<string>(); foreach (DatabaseFieldDefinition f in t.Fields) cols.Add(f.Name);
                        ts.Add(new Dictionary<string, object> { { "table", t.Location }, { "fields", cols } });
                    }
                    var subs = new List<string>(); foreach (ReportDocument sub in d.Subreports) subs.Add(sub.Name);
                    var texts = new List<string>();
                    foreach (ReportObject o in d.ReportDefinition.ReportObjects)
                    {
                        TextObject to = o as TextObject;
                        if (to != null && !string.IsNullOrEmpty(to.Text)) texts.Add(o.Name + "|" + to.Text.Replace("\r", " ").Replace("\n", " "));
                    }
                    info["parameters"] = ps; info["formulas"] = fs; info["tables"] = ts; info["subreports"] = subs; info["texts"] = texts;
                    info["selection"] = d.RecordSelectionFormula; info["paper"] = d.PrintOptions.PaperSize.ToString(); info["orientation"] = d.PrintOptions.PaperOrientation.ToString(); info["paper_facts"] = PaperFacts(d);
                    Send(ctx, 200, "application/json", Json.Serialize(info));
                }
            }
        }
    }
}
