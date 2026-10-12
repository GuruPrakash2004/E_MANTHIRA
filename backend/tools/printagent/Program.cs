// vTemple Print Agent — a tiny loopback HTTP server that lets the vTemple web
// app print on the printers physically attached to THIS counter PC, silently
// (no browser print dialog). One instance per Windows user. See
// backend/tools/printagent/README.md for the protocol and security model.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Printing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;

namespace VTemplePrintAgent
{
    internal static class Program
    {
        private const int Port = 8787;
        private const string AgentId = "vtemple-print-agent";
        private const string Version = "1.0";

        private static readonly object PrintLock = new object();
        private static Mutex _singleInstance;
        private static string _dataDir;
        private static HashSet<string> _allowedOrigins;
        private static bool _allowAnyOrigin;

        [STAThread]
        private static void Main()
        {
            bool createdNew;
            _singleInstance = new Mutex(true, "Local\\VTemplePrintAgent", out createdNew);
            if (!createdNew)
            {
                return; // already running for this Windows user
            }

            _dataDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "VTemplePrintAgent");
            Directory.CreateDirectory(_dataDir);
            LoadAllowedOrigins();

            TcpListener listener = null;
            try
            {
                listener = new TcpListener(IPAddress.Loopback, Port);
                listener.Start();
            }
            catch (Exception ex)
            {
                Log("FATAL: could not bind 127.0.0.1:" + Port + " — " + ex.Message);
                return;
            }

            Log("vTemple Print Agent listening on http://127.0.0.1:" + Port);
            while (true)
            {
                try
                {
                    var client = listener.AcceptTcpClient();
                    ThreadPool.QueueUserWorkItem(HandleClient, client);
                }
                catch (Exception ex)
                {
                    Log("accept loop error: " + ex.Message);
                }
            }
        }

        private static void LoadAllowedOrigins()
        {
            _allowedOrigins = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            _allowAnyOrigin = false;
            var path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "printagent.txt");
            if (!File.Exists(path)) return;
            foreach (var raw in File.ReadAllLines(path))
            {
                var line = raw.Trim();
                if (line.Length == 0 || line.StartsWith("#")) continue;
                if (line == "*") { _allowAnyOrigin = true; continue; }
                _allowedOrigins.Add(line.TrimEnd('/'));
            }
        }

        private static bool OriginAllowed(string origin)
        {
            if (string.IsNullOrEmpty(origin)) return false;
            if (_allowAnyOrigin) return true;
            return _allowedOrigins.Contains(origin.TrimEnd('/'));
        }

        private static void HandleClient(object state)
        {
            var client = (TcpClient)state;
            try
            {
                client.ReceiveTimeout = 20000;
                client.SendTimeout = 20000;
                using (var stream = client.GetStream())
                {
                    HttpRequest req;
                    try
                    {
                        req = HttpRequest.Read(stream);
                    }
                    catch
                    {
                        return;
                    }
                    if (req == null) return;

                    var origin = req.Headers.ContainsKey("Origin") ? req.Headers["Origin"] : "";

                    if (req.Method == "OPTIONS")
                    {
                        WriteNoBody(stream, 204, origin);
                        return;
                    }

                    if (req.Path == "/health" && req.Method == "GET")
                    {
                        HandleHealth(stream, origin);
                        return;
                    }

                    if (req.Path == "/print" && req.Method == "POST")
                    {
                        if (!OriginAllowed(origin))
                        {
                            WriteJson(stream, 403, origin, "{\"error\":\"This page is not allowed to use the print agent\"}");
                            return;
                        }
                        HandlePrint(stream, origin, req.Body);
                        return;
                    }

                    WriteJson(stream, 404, origin, "{\"error\":\"not found\"}");
                }
            }
            catch (Exception ex)
            {
                Log("request error: " + ex.Message);
            }
            finally
            {
                try { client.Close(); } catch { }
            }
        }

        private static void HandleHealth(NetworkStream stream, string origin)
        {
            string defaultPrinter = "";
            try { defaultPrinter = new PrinterSettings().PrinterName; } catch { }

            var names = new List<string>();
            foreach (string name in PrinterSettings.InstalledPrinters) names.Add(name);

            var sb = new StringBuilder();
            sb.Append("{\"agent\":\"").Append(AgentId).Append("\",");
            sb.Append("\"version\":\"").Append(Version).Append("\",");
            sb.Append("\"host\":\"").Append(JsonEscape(Environment.MachineName)).Append("\",");
            sb.Append("\"default\":\"").Append(JsonEscape(defaultPrinter)).Append("\",");
            sb.Append("\"printers\":[");
            for (int i = 0; i < names.Count; i++)
            {
                if (i > 0) sb.Append(",");
                sb.Append("\"").Append(JsonEscape(names[i])).Append("\"");
            }
            sb.Append("]}");
            WriteJson(stream, 200, origin, sb.ToString());
        }

        private static void HandlePrint(NetworkStream stream, string origin, byte[] body)
        {
            if (body == null || body.Length == 0)
            {
                WriteJson(stream, 422, origin, "{\"error\":\"no body\"}");
                return;
            }
            if (body.Length > 64 * 1024 * 1024)
            {
                WriteJson(stream, 413, origin, "{\"error\":\"payload too large\"}");
                return;
            }

            PrintJob job;
            try
            {
                job = PrintJob.Parse(Encoding.UTF8.GetString(body));
            }
            catch (Exception ex)
            {
                WriteJson(stream, 422, origin, "{\"error\":\"bad request: " + JsonEscape(ex.Message) + "\"}");
                return;
            }

            if (job.Pages.Count == 0)
            {
                WriteJson(stream, 422, origin, "{\"error\":\"no pages\"}");
                return;
            }

            string printerName = job.Printer;
            if (string.IsNullOrEmpty(printerName))
            {
                try { printerName = new PrinterSettings().PrinterName; }
                catch { printerName = ""; }
                if (string.IsNullOrEmpty(printerName))
                {
                    WriteJson(stream, 409, origin, "{\"error\":\"This PC has no default printer\"}");
                    return;
                }
            }

            bool found = false;
            foreach (string name in PrinterSettings.InstalledPrinters)
            {
                if (string.Equals(name, printerName, StringComparison.OrdinalIgnoreCase)) { found = true; printerName = name; break; }
            }
            if (!found)
            {
                WriteJson(stream, 500, origin, "{\"error\":\"This PC has no printer called " + JsonEscape(printerName) + "\"}");
                return;
            }

            int copies = job.Copies <= 0 ? 1 : job.Copies;
            if (copies > 20) copies = 20;

            lock (PrintLock)
            {
                try
                {
                    PrintPages(printerName, job, copies);
                }
                catch (Exception ex)
                {
                    Log("print failed on " + printerName + ": " + ex.Message);
                    WriteJson(stream, 500, origin, "{\"error\":" + JsonQuote(ex.Message) + "}");
                    return;
                }
            }

            Log("printed \"" + job.Name + "\" x" + copies + " on " + printerName);
            WriteJson(
                stream,
                200,
                origin,
                "{\"printed\":true,\"printer\":" + JsonQuote(printerName) + ",\"copies\":" + copies + "}");
        }

        private static void PrintPages(string printerName, PrintJob job, int copies)
        {
            var images = new List<Image>();
            try
            {
                foreach (var page in job.Pages)
                {
                    var bytes = Convert.FromBase64String(page.PngBase64);
                    using (var ms = new MemoryStream(bytes))
                    {
                        images.Add(Image.FromStream(ms));
                    }
                }

                int pageIndex = 0;
                using (var doc = new PrintDocument())
                {
                    doc.PrinterSettings.PrinterName = printerName;
                    doc.PrinterSettings.Copies = (short)copies;
                    doc.OriginAtMargins = false;
                    doc.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);

                    var firstPage = job.Pages[0];
                    doc.DefaultPageSettings.PaperSize = new PaperSize(
                        "vTemple",
                        PointsToHundredthsInch(firstPage.WidthPt),
                        PointsToHundredthsInch(firstPage.HeightPt));

                    doc.PrintPage += (sender, e) =>
                    {
                        var img = images[pageIndex];
                        var bounds = e.PageBounds;
                        e.Graphics.DrawImage(img, new Rectangle(0, 0, bounds.Width, bounds.Height));
                        pageIndex++;
                        e.HasMorePages = pageIndex < images.Count;
                    };

                    doc.Print();
                }
            }
            finally
            {
                foreach (var img in images) { try { img.Dispose(); } catch { } }
            }
        }

        private static int PointsToHundredthsInch(double points)
        {
            var inches = points / 72.0;
            var v = (int)Math.Round(inches * 100.0);
            return v < 100 ? 100 : v; // PaperSize needs a positive size
        }

        private static void WriteJson(NetworkStream stream, int status, string origin, string json)
        {
            var bytes = Encoding.UTF8.GetBytes(json);
            var headers = BaseHeaders(status, origin);
            headers.Append("Content-Type: application/json; charset=utf-8\r\n");
            headers.Append("Content-Length: ").Append(bytes.Length).Append("\r\n\r\n");
            var headerBytes = Encoding.ASCII.GetBytes(headers.ToString());
            stream.Write(headerBytes, 0, headerBytes.Length);
            stream.Write(bytes, 0, bytes.Length);
        }

        private static void WriteNoBody(NetworkStream stream, int status, string origin)
        {
            var headers = BaseHeaders(status, origin);
            headers.Append("Content-Length: 0\r\n\r\n");
            var headerBytes = Encoding.ASCII.GetBytes(headers.ToString());
            stream.Write(headerBytes, 0, headerBytes.Length);
        }

        private static StringBuilder BaseHeaders(int status, string origin)
        {
            var sb = new StringBuilder();
            sb.Append("HTTP/1.1 ").Append(status).Append(" ").Append(StatusText(status)).Append("\r\n");
            sb.Append("Connection: close\r\n");
            if (!string.IsNullOrEmpty(origin))
            {
                sb.Append("Access-Control-Allow-Origin: ").Append(origin).Append("\r\n");
                sb.Append("Vary: Origin\r\n");
            }
            sb.Append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n");
            sb.Append("Access-Control-Allow-Headers: Content-Type\r\n");
            sb.Append("Access-Control-Allow-Private-Network: true\r\n");
            return sb;
        }

        private static string StatusText(int status)
        {
            switch (status)
            {
                case 200: return "OK";
                case 204: return "No Content";
                case 403: return "Forbidden";
                case 404: return "Not Found";
                case 409: return "Conflict";
                case 413: return "Payload Too Large";
                case 422: return "Unprocessable Entity";
                default: return "Internal Server Error";
            }
        }

        private static string JsonEscape(string s)
        {
            if (s == null) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", " ");
        }

        private static string JsonQuote(string s)
        {
            return "\"" + JsonEscape(s) + "\"";
        }

        private static void Log(string message)
        {
            try
            {
                var path = Path.Combine(_dataDir ?? Path.GetTempPath(), "printagent.log");
                var fi = new FileInfo(path);
                if (fi.Exists && fi.Length > 512 * 1024)
                {
                    File.Delete(path);
                }
                File.AppendAllText(path, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + message + Environment.NewLine);
            }
            catch { }
        }

        // ---- minimal HTTP/1.1 request parsing (method, path, headers, body) ----
        private sealed class HttpRequest
        {
            public string Method;
            public string Path;
            public Dictionary<string, string> Headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            public byte[] Body;

            public static HttpRequest Read(NetworkStream stream)
            {
                var headerBytes = new List<byte>();
                var buffer = new byte[1];
                var sawCrLfCrLf = false;
                while (!sawCrLfCrLf)
                {
                    int n = stream.Read(buffer, 0, 1);
                    if (n == 0) return null;
                    headerBytes.Add(buffer[0]);
                    int c = headerBytes.Count;
                    if (c >= 4 &&
                        headerBytes[c - 4] == '\r' && headerBytes[c - 3] == '\n' &&
                        headerBytes[c - 2] == '\r' && headerBytes[c - 1] == '\n')
                    {
                        sawCrLfCrLf = true;
                    }
                    if (c > 32 * 1024) throw new Exception("headers too large");
                }

                var headerText = Encoding.ASCII.GetString(headerBytes.ToArray());
                var lines = headerText.Split(new[] { "\r\n" }, StringSplitOptions.None);
                var requestLine = lines[0].Split(' ');
                var req = new HttpRequest
                {
                    Method = requestLine[0],
                    Path = requestLine.Length > 1 ? requestLine[1] : "/",
                };

                for (int i = 1; i < lines.Length; i++)
                {
                    var line = lines[i];
                    if (line.Length == 0) continue;
                    int idx = line.IndexOf(':');
                    if (idx <= 0) continue;
                    var key = line.Substring(0, idx).Trim();
                    var value = line.Substring(idx + 1).Trim();
                    req.Headers[key] = value;
                }

                int contentLength = 0;
                if (req.Headers.ContainsKey("Content-Length"))
                {
                    int.TryParse(req.Headers["Content-Length"], out contentLength);
                }

                if (contentLength > 0)
                {
                    if (contentLength > 80 * 1024 * 1024) throw new Exception("body too large");
                    var body = new byte[contentLength];
                    int read = 0;
                    while (read < contentLength)
                    {
                        int n = stream.Read(body, read, contentLength - read);
                        if (n == 0) break;
                        read += n;
                    }
                    req.Body = body;
                }
                else
                {
                    req.Body = new byte[0];
                }

                return req;
            }
        }

        // ---- very small JSON reader, just enough for the /print payload ----
        private sealed class PrintJob
        {
            public string Printer = "";
            public int Copies = 1;
            public string Name = "";
            public List<PrintPage> Pages = new List<PrintPage>();

            public static PrintJob Parse(string json)
            {
                var root = (Dictionary<string, object>)MiniJson.Parse(json);
                var job = new PrintJob();
                if (root.ContainsKey("printer")) job.Printer = Convert.ToString(root["printer"]);
                if (root.ContainsKey("name")) job.Name = Convert.ToString(root["name"]);
                if (root.ContainsKey("copies")) job.Copies = Convert.ToInt32(Convert.ToDouble(root["copies"]));
                if (root.ContainsKey("pages"))
                {
                    foreach (var raw in (List<object>)root["pages"])
                    {
                        var p = (Dictionary<string, object>)raw;
                        job.Pages.Add(new PrintPage
                        {
                            PngBase64 = Convert.ToString(p["png"]),
                            WidthPt = Convert.ToDouble(p["w"]),
                            HeightPt = Convert.ToDouble(p["h"]),
                        });
                    }
                }
                return job;
            }
        }

        private sealed class PrintPage
        {
            public string PngBase64;
            public double WidthPt;
            public double HeightPt;
        }

        // Tiny recursive-descent JSON parser (object/array/string/number/bool/null) —
        // no external dependency, this agent ships as a single .exe built with csc.exe.
        private static class MiniJson
        {
            public static object Parse(string json)
            {
                int i = 0;
                return ParseValue(json, ref i);
            }

            private static object ParseValue(string s, ref int i)
            {
                SkipWs(s, ref i);
                char c = s[i];
                if (c == '{') return ParseObject(s, ref i);
                if (c == '[') return ParseArray(s, ref i);
                if (c == '"') return ParseString(s, ref i);
                if (c == 't') { i += 4; return true; }
                if (c == 'f') { i += 5; return false; }
                if (c == 'n') { i += 4; return null; }
                return ParseNumber(s, ref i);
            }

            private static Dictionary<string, object> ParseObject(string s, ref int i)
            {
                var obj = new Dictionary<string, object>();
                i++; // {
                SkipWs(s, ref i);
                if (s[i] == '}') { i++; return obj; }
                while (true)
                {
                    SkipWs(s, ref i);
                    var key = ParseString(s, ref i);
                    SkipWs(s, ref i);
                    i++; // :
                    var value = ParseValue(s, ref i);
                    obj[key] = value;
                    SkipWs(s, ref i);
                    if (s[i] == ',') { i++; continue; }
                    i++; // }
                    break;
                }
                return obj;
            }

            private static List<object> ParseArray(string s, ref int i)
            {
                var list = new List<object>();
                i++; // [
                SkipWs(s, ref i);
                if (s[i] == ']') { i++; return list; }
                while (true)
                {
                    var value = ParseValue(s, ref i);
                    list.Add(value);
                    SkipWs(s, ref i);
                    if (s[i] == ',') { i++; continue; }
                    i++; // ]
                    break;
                }
                return list;
            }

            private static string ParseString(string s, ref int i)
            {
                i++; // opening quote
                var sb = new StringBuilder();
                while (s[i] != '"')
                {
                    if (s[i] == '\\')
                    {
                        i++;
                        char esc = s[i];
                        switch (esc)
                        {
                            case '"': sb.Append('"'); break;
                            case '\\': sb.Append('\\'); break;
                            case '/': sb.Append('/'); break;
                            case 'n': sb.Append('\n'); break;
                            case 'r': sb.Append('\r'); break;
                            case 't': sb.Append('\t'); break;
                            case 'b': sb.Append('\b'); break;
                            case 'f': sb.Append('\f'); break;
                            case 'u':
                                var hex = s.Substring(i + 1, 4);
                                sb.Append((char)Convert.ToInt32(hex, 16));
                                i += 4;
                                break;
                        }
                        i++;
                    }
                    else
                    {
                        sb.Append(s[i]);
                        i++;
                    }
                }
                i++; // closing quote
                return sb.ToString();
            }

            private static object ParseNumber(string s, ref int i)
            {
                int start = i;
                while (i < s.Length && "-+.0123456789eE".IndexOf(s[i]) >= 0) i++;
                return double.Parse(s.Substring(start, i - start), System.Globalization.CultureInfo.InvariantCulture);
            }

            private static void SkipWs(string s, ref int i)
            {
                while (i < s.Length && char.IsWhiteSpace(s[i])) i++;
            }
        }
    }
}
