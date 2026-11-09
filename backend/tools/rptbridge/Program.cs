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
using System.Runtime.InteropServices;
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
        private static string _fontDirs = ""; // --fonts: folders of .ttf/.otf/.ttc loaded for this process only
        private static int _fontsLoaded, _fontsInstalled;
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
                else if (args[i] == "--fonts") _fontDirs = next;
            }
            if (string.IsNullOrEmpty(_key)) { Console.Error.WriteLine("Refusing to start without a key (--key or RPT_BRIDGE_KEY)."); return 2; }
            if (!LoadDbSettings(settings, envFile)) { Console.Error.WriteLine("No DB settings (--settings <runtime_db_settings.json> and/or --env <.env>)."); return 2; }
            if (_rptRoot == null) _rptRoot = AppDomain.CurrentDomain.BaseDirectory;
            LoadFonts();
            // Only the service account's own default is changed: a person's real default printer is never touched.
            // (A different account can opt in with RPT_SET_DEFAULT_PRINTER=1.)
            if (string.Equals(Environment.UserName, Environment.MachineName + "$", StringComparison.OrdinalIgnoreCase)
                || string.Equals(Environment.UserName, "SYSTEM", StringComparison.OrdinalIgnoreCase)
                || Environment.GetEnvironmentVariable("RPT_SET_DEFAULT_PRINTER") == "1")
                _mayChangeDefault = true;
            new System.Threading.Thread(PrepareDefaultPrinter) { IsBackground = true }.Start();

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

        // ---- default printer ------------------------------------------------------------------------------------
        // Crystal lays every page out against the DEFAULT PRINTER of the account the bridge runs as. Roll receipts (custom paper)
        // cannot use the preview printer, so they use that default - and if it is an offline / network printer, each lookup waits
        // for a network timeout (seen: exactly ~48 s, at random, only on those reports). The bridge's own default is therefore
        // switched to a local virtual printer at start-up. This is per account (the service's), not the PC's other users.
        [DllImport("winspool.drv", EntryPoint = "SetDefaultPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool SetDefaultPrinter(string name);

        private static bool _mayChangeDefault;

        private static void PrepareDefaultPrinter()
        {
            try
            {
                var sw = System.Diagnostics.Stopwatch.StartNew();
                string current = new PrinterSettings().PrinterName;
                var names = new List<string>();
                foreach (string p in PrinterSettings.InstalledPrinters) names.Add(p);
                Console.Out.WriteLine("[printers] default='" + current + "' installed=[" + string.Join(" | ", names.ToArray()) + "] read in " + sw.ElapsedMilliseconds + "ms");
                string target = null;
                foreach (string pref in new[] { _previewPrinter, "Microsoft XPS Document Writer" })
                    if (!string.IsNullOrEmpty(pref) && names.Contains(pref)) { target = pref; break; }
                if (!_mayChangeDefault) { Console.Out.WriteLine("[printers] default left as is (not running as the service account)"); return; }
                if (target == null || string.Equals(current, target, StringComparison.OrdinalIgnoreCase)) return;
                sw.Restart();
                bool ok = SetDefaultPrinter(target);
                Console.Out.WriteLine("[printers] default set to '" + target + "' for this service: " + (ok ? "ok" : "failed " + Marshal.GetLastWin32Error()) + " (" + sw.ElapsedMilliseconds + "ms)");
            }
            catch (Exception ex) { Console.Out.WriteLine("[printers] could not prepare the default printer: " + ex.Message); }
        }

        // ---- fonts ----------------------------------------------------------------------------------------------
        // Legacy Indian-language reports (Kannada / Telugu / Tamil / Hindi ...) store their text in non-Unicode "ANSI"
        // fonts (BRH Kannada, Nudi, Shree-Lipi, ...). On a machine without that font Windows silently draws the bytes in
        // Times New Roman / Microsoft Sans Serif and the output is Latin gibberish. Every font file found in the folders
        // below is installed FOR THE CURRENT USER (copied to %LOCALAPPDATA%\Microsoft\Windows\Fonts + HKCU registry,
        // exactly what "Install for me" does: no admin rights, nothing system-wide) so the Crystal engine finds it. If
        // that is blocked, the font is loaded privately into this process instead.
        // Folders: --fonts a;b  +  <exe folder>\fonts  +  <rpts folder>\Fonts.   GET /fonts?rpt=<file> shows which
        // fonts a report uses and which of them this machine is missing.

        [DllImport("gdi32.dll", CharSet = CharSet.Unicode)]
        private static extern int AddFontResource(string file);
        [DllImport("gdi32.dll", CharSet = CharSet.Unicode)]
        private static extern int AddFontResourceEx(string file, uint flags, IntPtr reserved);
        [DllImport("user32.dll")]
        private static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
        private const uint FR_PRIVATE = 0x10;

        private static void LoadFonts()
        {
            var dirs = new List<string>();
            foreach (string d in (_fontDirs ?? "").Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries)) dirs.Add(d.Trim());
            dirs.Add(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "fonts"));
            dirs.Add(Path.Combine(_rptRoot, "Fonts"));
            string userFonts = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Microsoft\Windows\Fonts");
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            bool changed = false;
            foreach (string dir in dirs)
            {
                if (!Directory.Exists(dir) || !seen.Add(Path.GetFullPath(dir))) continue;
                foreach (string f in Directory.GetFiles(dir))
                {
                    string ext = Path.GetExtension(f).ToLowerInvariant();
                    if (ext != ".ttf" && ext != ".otf" && ext != ".ttc") continue;
                    try
                    {
                        Directory.CreateDirectory(userFonts);
                        string dst = Path.Combine(userFonts, Path.GetFileName(f));
                        string regName = Path.GetFileNameWithoutExtension(f) + (ext == ".otf" ? " (OpenType)" : " (TrueType)");
                        using (Microsoft.Win32.RegistryKey k = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts"))
                        {
                            bool known = File.Exists(dst) && string.Equals(k.GetValue(regName) as string, dst, StringComparison.OrdinalIgnoreCase);
                            if (!known)
                            {
                                File.Copy(f, dst, true);
                                k.SetValue(regName, dst, Microsoft.Win32.RegistryValueKind.String);
                                AddFontResource(dst);
                                changed = true;
                                _fontsInstalled++;
                            }
                        }
                        _fontsLoaded++;
                    }
                    catch (Exception)
                    {
                        if (AddFontResourceEx(f, FR_PRIVATE, IntPtr.Zero) > 0) _fontsLoaded++; // no per-user install possible: this process only
                    }
                }
            }
            if (changed) { IntPtr r; SendMessageTimeout((IntPtr)0xffff, 0x1D, IntPtr.Zero, IntPtr.Zero, 2, 1000, out r); } // WM_FONTCHANGE
            Console.WriteLine("Fonts available: " + _fontsLoaded + " (newly installed for this user: " + _fontsInstalled + ")");
        }

        // GET /fonts?rpt=<file>: every font the report's text / field objects use, and whether this machine has it.
        // (System.Drawing silently swaps a missing family for Microsoft Sans Serif, so the RAS object model is read.)
        private static void FontsOf(HttpListenerContext ctx, string rpt)
        {
            lock (RenderLock)
            {
                string fullRpt = ResolveRpt(rpt);
                try
                {
                    bool reusedDoc;
                    ReportDocument d = Acquire(rpt, "", new Dictionary<string, string>(), false, out reusedDoc);
                    var used = new SortedDictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                    object rcd = Dyn(d, "ReportClientDocument");
                    object areas = Dyn(Dyn(Dyn(rcd, "ReportDefController"), "ReportDefinition"), "Areas");
                    int na = Convert.ToInt32(Dyn(areas, "Count"));
                    for (int a = 0; a < na; a++)
                    {
                        object secs = Dyn(Item(areas, a), "Sections");
                        for (int s = 0; s < Convert.ToInt32(Dyn(secs, "Count")); s++)
                        {
                            object objs = Dyn(Item(secs, s), "ReportObjects");
                            for (int i = 0; i < Convert.ToInt32(Dyn(objs, "Count")); i++)
                            {
                                try
                                {
                                    string name = Convert.ToString(Dyn(Dyn(Dyn(Item(objs, i), "FontColor"), "Font"), "Name"));
                                    if (string.IsNullOrEmpty(name)) continue;
                                    int n; used.TryGetValue(name, out n); used[name] = n + 1;
                                }
                                catch (Exception) { /* lines, boxes, pictures have no font */ }
                            }
                        }
                    }
                    var list = new List<object>();
                    foreach (var kv in used)
                    {
                        bool have;
                        using (var f = new System.Drawing.Font(kv.Key, 10)) have = string.Equals(f.Name, kv.Key, StringComparison.OrdinalIgnoreCase);
                        list.Add(new Dictionary<string, object> { { "font", kv.Key }, { "objects", kv.Value }, { "installed", have } });
                    }
                    Send(ctx, 200, "application/json", Json.Serialize(new Dictionary<string, object> { { "fonts", list }, { "font_folders_loaded", _fontsLoaded } }));
                }
                catch { Evict(fullRpt); throw; }
            }
        }

        private static object Dyn(object o, string prop) { return o.GetType().InvokeMember(prop, System.Reflection.BindingFlags.GetProperty, null, o, null); }
        private static object Item(object coll, int i) { return coll.GetType().InvokeMember("Item", System.Reflection.BindingFlags.GetProperty, null, coll, new object[] { i }); }

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
                Send(ctx, 200, "application/json", Json.Serialize(new Dictionary<string, object> { { "ok", true }, { "renderer", "crystal" }, { "db", _server + "/" + _db }, { "fonts_loaded", _fontsLoaded } }));
                return;
            }
            if (path == "/fonts" && ctx.Request.HttpMethod == "GET")
            {
                FontsOf(ctx, ctx.Request.QueryString["rpt"] ?? "");
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
                if (path == "/render")
                {
                    string full = ResolveRpt(rpt);
                    var sw = System.Diagnostics.Stopwatch.StartNew();
                    for (int attempt = 0; ; attempt++)
                    {
                        bool reused = false;
                        try
                        {
                            ReportDocument doc = Acquire(rpt, formula, values, true, out reused);
                            long tAcquire = sw.ElapsedMilliseconds;
                            UsePreviewPrinter(doc);
                            double widenedTo = WidenRollPaper(doc);
                            long tPrinter = sw.ElapsedMilliseconds;
                            using (Stream s = doc.ExportToStream(ExportFormatType.PortableDocFormat))
                            {
                                var ms = new MemoryStream();
                                s.CopyTo(ms);
                                foreach (var kv in PaperFacts(doc)) ctx.Response.AddHeader(kv.Key, kv.Value);
                                NamedWiden nw;
                                if (widenedTo > 0 && WidenedNamed.TryGetValue(doc, out nw))
                                {
                                    ctx.Response.Headers["X-Paper-Kind"] = "Named";
                                    ctx.Response.Headers["X-Paper-Name"] = nw.Name;
                                    ctx.Response.Headers["X-Orientation"] = nw.Orientation;
                                    ctx.Response.AddHeader("X-Orig-Page-Pt", nw.OrigW.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture) + "x" + nw.OrigH.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture));
                                    ctx.Response.AddHeader("X-Widened-Right-Pt", widenedTo.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture));
                                }
                                else if (widenedTo > 0)
                                {
                                    ctx.Response.Headers["X-Paper-Kind"] = "Custom"; // it is still the roll receipt; only the preview's page was widened
                                    ctx.Response.AddHeader("X-Widened-Right-Pt", widenedTo.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture));
                                }
                                Send(ctx, 200, "application/pdf", ms.ToArray());
                                Console.Out.WriteLine("[render] " + Path.GetFileName(full) + " reused=" + reused + " acquire=" + tAcquire + "ms printer=" + (tPrinter - tAcquire) + "ms export=" + (sw.ElapsedMilliseconds - tPrinter) + "ms");
                            }
                            break;
                        }
                        catch
                        {
                            Evict(full);
                            if (!reused || attempt >= 1) throw; // a stale cached report (e.g. the DB link dropped while idle): reload once, silently
                        }
                    }
                }
                else
                {
                    using (ReportDocument doc = Open(rpt, formula, values))
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

        // Enumerating printers can take seconds on a service account / server PC (spooler, network printers), and it ran on every
        // render - and on a server without "Microsoft Print to PDF" the miss repeated every time. The list is kept for 60 s,
        // and a name that is not in a list younger than 10 s is simply reported missing.
        private static HashSet<string> _printers;
        private static DateTime _printersAt = DateTime.MinValue;

        private static bool PrinterExists(string name)
        {
            bool fresh = false;   // true once the list was read during THIS call
            if (_printers == null || DateTime.UtcNow - _printersAt > TimeSpan.FromSeconds(60)) { ReadPrinters(); fresh = true; }
            if (_printers.Contains(name)) return true;
            if (fresh || DateTime.UtcNow - _printersAt <= TimeSpan.FromSeconds(10)) return false;
            ReadPrinters();       // an older list: one fresh read before saying no
            return _printers.Contains(name);
        }

        private static void ReadPrinters()
        {
            var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string p in PrinterSettings.InstalledPrinters) set.Add(p);
            _printers = set; _printersAt = DateTime.UtcNow;
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

        // A report stays loaded between prints: Load + DB logon + PinPaper is most of a render's time. Every use re-sets the
        // parameters and the selection formula and Refresh()es the data, so a record never sees another record's rows. Only used
        // under RenderLock (the engine is single-threaded); any error evicts the entry so the next print starts from a clean load.
        private sealed class CachedDoc { public ReportDocument Doc; public DateTime Stamp; public DateTime Used; }
        private static readonly Dictionary<string, CachedDoc> DocCache = new Dictionary<string, CachedDoc>(StringComparer.OrdinalIgnoreCase);
        private const int MaxCachedDocs = 8;

        private static void Evict(string full)
        {
            CachedDoc c;
            if (!DocCache.TryGetValue(full, out c)) return;
            DocCache.Remove(full);
            try { c.Doc.Dispose(); } catch { }
        }

        // Returns a ready-to-export document. refresh=false is for read-only callers (warm-up, /fonts) that never export.
        private static ReportDocument Acquire(string rptPath, string selectionFormula, Dictionary<string, string> values, bool refresh, out bool reused)
        {
            string full = ResolveRpt(rptPath);
            DateTime stamp = File.GetLastWriteTimeUtc(full);
            reused = false;
            CachedDoc c;
            if (DocCache.TryGetValue(full, out c) && c.Stamp == stamp)
            {
                try
                {
                    if (refresh) c.Doc.Refresh(); // Refresh clears parameter values, so it comes before they are set
                    SetParameters(c.Doc, values);
                    c.Doc.RecordSelectionFormula = selectionFormula ?? "";
                    c.Used = DateTime.UtcNow;
                    reused = true;
                    return c.Doc;
                }
                catch { Evict(full); }
            }
            else if (c != null) Evict(full); // the .rpt file was replaced

            ReportDocument doc = Open(rptPath, selectionFormula, values);
            if (DocCache.Count >= MaxCachedDocs)
            {
                string oldest = null; DateTime oldestAt = DateTime.MaxValue;
                foreach (var kv in DocCache) if (kv.Value.Used < oldestAt) { oldest = kv.Key; oldestAt = kv.Value.Used; }
                if (oldest != null) Evict(oldest);
            }
            DocCache[full] = new CachedDoc { Doc = doc, Stamp = stamp, Used = DateTime.UtcNow };
            return doc;
        }

        private static ReportDocument Open(string rptPath, string selectionFormula, Dictionary<string, string> values)
        {
            var doc = new ReportDocument();
            try
            {
                var sw = System.Diagnostics.Stopwatch.StartNew();
                doc.Load(ResolveRpt(rptPath));
                long tLoad = sw.ElapsedMilliseconds;
                PinPaper(doc);
                long tPin = sw.ElapsedMilliseconds;
                Logon(doc);
                long tLogon = sw.ElapsedMilliseconds;
                int subs = 0;
                foreach (ReportDocument sub in doc.Subreports) { Logon(sub); subs++; }
                long tSubs = sw.ElapsedMilliseconds;
                SetParameters(doc, values);
                if (!string.IsNullOrEmpty(selectionFormula)) doc.RecordSelectionFormula = selectionFormula;
                Console.Out.WriteLine("[open] " + Path.GetFileName(rptPath) + " load=" + tLoad + "ms paper=" + (tPin - tLoad) + "ms logon=" + (tLogon - tPin) + "ms subreports(" + subs + ")=" + (tSubs - tLogon) + "ms params=" + (sw.ElapsedMilliseconds - tSubs) + "ms");
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
        private static readonly System.Runtime.CompilerServices.ConditionalWeakTable<ReportDocument, object> PreviewPrinterSet =
            new System.Runtime.CompilerServices.ConditionalWeakTable<ReportDocument, object>();

        private static void UsePreviewPrinter(ReportDocument doc)
        {
            object done;
            if (PreviewPrinterSet.TryGetValue(doc, out done)) return; // a cached report keeps its printer; re-assigning it makes Crystal reload the driver
            if (string.IsNullOrEmpty(_previewPrinter) || !PrinterExists(_previewPrinter)) return;
            // only for named paper sizes (A4, Letter...); a custom roll size (e.g. the 3-inch receipts) is not a size the PDF printer knows
            if (!Enum.IsDefined(typeof(CrystalDecisions.Shared.PaperSize), doc.PrintOptions.PaperSize)) return;
            try { doc.PrintOptions.PrinterName = _previewPrinter; PreviewPrinterSet.Add(doc, new object()); } catch { }
        }


        // A roll receipt whose objects run past the roll's declared page width (fmtHB_3Inc: the date and the amount box end
        // ~20pt beyond 204pt) is clipped by Crystal at export. For the PREVIEW the page is given a wider named size so nothing is
        // cut; the backend then trims the page back to the right-most object. The report itself is not changed, direct printing
        // does not come through here. Remembered per cached report because a widened report reads as a named size afterwards.
        private static readonly System.Runtime.CompilerServices.ConditionalWeakTable<ReportDocument, object> Widened =
            new System.Runtime.CompilerServices.ConditionalWeakTable<ReportDocument, object>();

        private static double WidenRollPaper(ReportDocument doc)
        {
            try
            {
                object known;
                if (Widened.TryGetValue(doc, out known)) return (double)known;
                if (Enum.IsDefined(typeof(CrystalDecisions.Shared.PaperSize), doc.PrintOptions.PaperSize))
                {
                    double named = WidenNamedPaper(doc);
                    Widened.Add(doc, (object)named);
                    return named;
                }
                double right = 0;
                foreach (ReportObject o in doc.ReportDefinition.ReportObjects) right = Math.Max(right, (o.Left + o.Width) / 20.0);
                double content = doc.PrintOptions.PageContentWidth / 20.0;
                if (right <= content + 1) { Widened.Add(doc, (object)0.0); return 0; }
                var margins = doc.PrintOptions.PageMargins;
                // the roll's own printer (RP 3220 star) fixes the page at its roll width; the preview printer takes the wider named size
                if (!string.IsNullOrEmpty(_previewPrinter) && PrinterExists(_previewPrinter)) doc.PrintOptions.PrinterName = _previewPrinter;
                doc.PrintOptions.PaperSize = CrystalDecisions.Shared.PaperSize.PaperA5;
                try { doc.PrintOptions.ApplyPageMargins(margins); } catch { }
                Widened.Add(doc, (object)right);
                Console.Out.WriteLine("[paper] roll page widened for preview: objects end at " + right.ToString("0.#") + "pt, page content was " + content.ToString("0.#") + "pt");
                return right;
            }
            catch (Exception ex) { Console.Out.WriteLine("[paper] widen skipped: " + ex.Message); return 0; }
        }

        // A report on a named paper (A4...) whose objects run past the page's right margin (RptDtlCompDaySmry: the Grand Total column)
        // is clipped by the PDF export, while the Crystal viewer of the desktop shows it whole. For the PREVIEW the next larger
        // named paper is used; the backend then cuts the page box back to the original paper's height and to the right-most object
        // (X-Orig-Page-Pt, X-Widened-Right-Pt). The .rpt is not changed and direct printing does not come through here.
        private sealed class NamedWiden { public string Name; public string Orientation; public double OrigW, OrigH; }
        private static readonly System.Runtime.CompilerServices.ConditionalWeakTable<ReportDocument, NamedWiden> WidenedNamed =
            new System.Runtime.CompilerServices.ConditionalWeakTable<ReportDocument, NamedWiden>();

        private static bool NamedSize(CrystalDecisions.Shared.PaperSize p, out double w, out double h, out CrystalDecisions.Shared.PaperSize next)
        {
            next = CrystalDecisions.Shared.PaperSize.PaperA3;
            switch (p)
            {
                case CrystalDecisions.Shared.PaperSize.PaperA5: w = 420; h = 595; next = CrystalDecisions.Shared.PaperSize.PaperA4; return true;
                case CrystalDecisions.Shared.PaperSize.PaperA4: w = 595; h = 842; return true;
                case CrystalDecisions.Shared.PaperSize.PaperLetter: w = 612; h = 792; return true;
                case CrystalDecisions.Shared.PaperSize.PaperLegal: w = 612; h = 1008; return true;
            }
            w = h = 0;
            return false;
        }

        private static double WidenNamedPaper(ReportDocument doc)
        {
            try
            {
                double w, h; CrystalDecisions.Shared.PaperSize next;
                if (!NamedSize(doc.PrintOptions.PaperSize, out w, out h, out next)) return 0;
                bool landscape = doc.PrintOptions.PaperOrientation == PaperOrientation.Landscape;
                double pageW = landscape ? h : w, pageH = landscape ? w : h;
                var margins = doc.PrintOptions.PageMargins;
                double right = 0;
                foreach (ReportObject o in doc.ReportDefinition.ReportObjects) right = Math.Max(right, (o.Left + o.Width) / 20.0);
                double content = doc.PrintOptions.PageContentWidth / 20.0;
                if (right <= content + 3) return 0; // fits (a hairline past the margin is not a clip)
                if (string.IsNullOrEmpty(_previewPrinter) || !PrinterExists(_previewPrinter)) return 0;
                var info = new NamedWiden { Name = doc.PrintOptions.PaperSize.ToString(), Orientation = doc.PrintOptions.PaperOrientation.ToString(), OrigW = pageW, OrigH = pageH };
                doc.PrintOptions.PrinterName = _previewPrinter;
                doc.PrintOptions.PaperSize = next;
                doc.PrintOptions.PaperOrientation = landscape ? PaperOrientation.Landscape : PaperOrientation.Portrait;
                try { doc.PrintOptions.ApplyPageMargins(margins); } catch { }
                WidenedNamed.Add(doc, info);
                double pageRight = margins.leftMargin / 20.0 + right; // objects are measured from the left margin
                Console.Out.WriteLine("[paper] " + info.Name + " page widened for preview: objects end at " + pageRight.ToString("0.#") + "pt of " + pageW.ToString("0.#") + "pt");
                return pageRight;
            }
            catch (Exception ex) { Console.Out.WriteLine("[paper] named widen skipped: " + ex.Message); return 0; }
        }

        // What the report itself says about its page. "Custom" =a paper size Windows has no name for (the 3-inch roll receipts);
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
                var tw = System.Diagnostics.Stopwatch.StartNew();
                t.ApplyLogOnInfo(info);
                if (tw.ElapsedMilliseconds > 500) Console.Out.WriteLine("[logon] table " + t.Name + " took " + tw.ElapsedMilliseconds + "ms");
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
