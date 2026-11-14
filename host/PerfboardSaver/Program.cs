// Perfboard clock — Windows screensaver host (WebView2, multi-monitor).
//
//   PerfboardSaver.scr            same as /s
//   PerfboardSaver.scr /s         run: clock on the middle monitor, black elsewhere
//   PerfboardSaver.scr /c         settings: which monitor, scale, position
//   PerfboardSaver.scr /p <hwnd>  control-panel preview pane (black)
//
// While running:  + / -  scale,  arrows  move,  R  reset,  anything else quits.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Globalization;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace PerfboardSaver
{
    public sealed class Config
    {
        public string Monitor { get; set; } = "middle";   // middle|primary|left|right|<index>
        public double Zoom { get; set; } = 0.40;          // 1 = board fitted to the screen
        public double OffsetX { get; set; } = 0.00;       // fraction of screen width
        public double OffsetY { get; set; } = 0.00;       // fraction of screen height

        public static string Dir => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PerfboardSaver");

        public static string FilePath => Path.Combine(Dir, "config.json");

        public static Config Load()
        {
            try
            {
                if (!File.Exists(FilePath)) return new Config();
                string t = File.ReadAllText(FilePath);
                Config c = new Config();
                string m = Str(t, "Monitor");
                if (m != null) c.Monitor = m;
                c.Zoom = ClampZoom(Num(t, "Zoom", c.Zoom));
                c.OffsetX = ClampOff(Num(t, "OffsetX", c.OffsetX));
                c.OffsetY = ClampOff(Num(t, "OffsetY", c.OffsetY));
                return c;
            }
            catch { /* a broken config must never stop the screensaver */ }
            return new Config();
        }

        public void Save()
        {
            try
            {
                Directory.CreateDirectory(Dir);
                File.WriteAllText(FilePath,
                    "{\n" +
                    "  \"Monitor\": \"" + (Monitor ?? "middle").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\",\n" +
                    "  \"Zoom\": " + Zoom.ToString("0.####", CultureInfo.InvariantCulture) + ",\n" +
                    "  \"OffsetX\": " + OffsetX.ToString("0.####", CultureInfo.InvariantCulture) + ",\n" +
                    "  \"OffsetY\": " + OffsetY.ToString("0.####", CultureInfo.InvariantCulture) + "\n" +
                    "}\n");
            }
            catch { }
        }

        // The config is four fields; a regex per field is smaller than any JSON library
        // and keeps this file identical for .NET Framework and .NET 8.
        private static string Str(string text, string key)
        {
            Match m = Regex.Match(text, "\"" + key + "\"\\s*:\\s*\"([^\"]*)\"");
            return m.Success ? m.Groups[1].Value : null;
        }

        private static double Num(string text, string key, double fallback)
        {
            Match m = Regex.Match(text, "\"" + key + "\"\\s*:\\s*(-?[0-9]+(?:\\.[0-9]+)?)");
            return m.Success && double.TryParse(m.Groups[1].Value, NumberStyles.Float,
                                               CultureInfo.InvariantCulture, out double v) ? v : fallback;
        }

        public static double ClampZoom(double z) => Math.Max(0.15, Math.Min(6.0, z));
        public static double ClampOff(double o) => Math.Max(-1.0, Math.Min(1.0, o));
    }

    internal static class Program
    {
        public static string SceneFile
        {
            get
            {
                Directory.CreateDirectory(Config.Dir);
                string f = Path.Combine(Config.Dir, "scene.html");
                using Stream s = typeof(Program).Assembly.GetManifestResourceStream("scene.html");
                if (s == null) return f;
                bool stale = !File.Exists(f) || new FileInfo(f).Length != s.Length;
                if (stale)
                {
                    using FileStream o = File.Create(f);
                    s.CopyTo(o);
                }
                return f;
            }
        }

        public static Screen PickScreen(string mode)
        {
            Screen[] ordered = Screen.AllScreens.OrderBy(s => s.Bounds.Left).ThenBy(s => s.Bounds.Top).ToArray();
            mode = (mode ?? "middle").Trim().ToLowerInvariant();

            if (mode == "primary" && Screen.PrimaryScreen != null) return Screen.PrimaryScreen;
            if (mode == "left") return ordered[0];
            if (mode == "right") return ordered[ordered.Length - 1];
            if (int.TryParse(mode, out int idx) && idx >= 0 && idx < ordered.Length) return ordered[idx];

            Rectangle vs = SystemInformation.VirtualScreen;
            Point c = new Point(vs.Left + vs.Width / 2, vs.Top + vs.Height / 2);
            foreach (Screen sc in ordered)
                if (sc.Bounds.Contains(c)) return sc;
            return Screen.PrimaryScreen ?? ordered[0];
        }

        [STAThread]
        private static void Main(string[] args)
        {
            Bootstrap.Install();   // no-op on .NET 8; serves the embedded assemblies on .NET Framework
#if NETFRAMEWORK
            // DPI awareness comes from the manifest on .NET Framework
#else
            Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
#endif
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string mode = args.Length > 0 ? args[0].Trim().ToLowerInvariant() : "/s";

            if (mode.StartsWith("/c"))
            {
                Application.Run(new SettingsForm());
                return;
            }

            if (mode.StartsWith("/p"))
            {
                RunPreview(args.Length > 1 ? args[1] : null);
                return;
            }

            Application.Run(new SaverContext());
        }

        // Control-panel preview pane: black only, parented into the little window.
        private static void RunPreview(string hwndText)
        {
            try
            {
                if (hwndText == null) return;
                IntPtr hwnd = new IntPtr(long.Parse(hwndText));
                Control parent = Control.FromHandle(hwnd);
                if (parent == null) return;
                var f = new Form
                {
                    FormBorderStyle = FormBorderStyle.None,
                    BackColor = Color.Black,
                    TopLevel = false,
                    Parent = parent,
                    Bounds = parent.ClientRectangle,
                    Dock = DockStyle.Fill
                };
                f.Show();
                var t = new System.Windows.Forms.Timer { Interval = 400 };
                t.Tick += (s, e) =>
                {
                    if (!parent.IsDisposed) f.Bounds = parent.ClientRectangle;
                    else Application.Exit();
                };
                t.Start();
                Application.Run();
            }
            catch { }
        }
    }

    /// <summary>One black form per monitor, the clock in a WebView2 on one of them.</summary>
    internal sealed class SaverContext : ApplicationContext
    {
        private readonly List<Form> _forms = new List<Form>();
        private readonly Config _cfg;
        private Point _mouse0;
        private bool _quitting;

        public SaverContext()
        {
            _cfg = Config.Load();
            Screen target = Program.PickScreen(_cfg.Monitor);
            _mouse0 = Cursor.Position;
            Cursor.Hide();

            foreach (Screen sc in Screen.AllScreens)
            {
                bool isClock = sc.DeviceName == target.DeviceName && sc.Bounds == target.Bounds;
                Form f = isClock
                    ? new ClockForm(sc, _cfg, Quit)
                    : new BlackForm(sc);
                _forms.Add(f);
                f.Show();
            }

            var t = new System.Windows.Forms.Timer { Interval = 250 };
            t.Tick += (s, e) =>
            {
                Point p = Cursor.Position;
                if (Math.Abs(p.X - _mouse0.X) > 12 || Math.Abs(p.Y - _mouse0.Y) > 12) Quit();
            };
            t.Start();
        }

        public void Quit()
        {
            if (_quitting) return;
            _quitting = true;
            try { Cursor.Show(); } catch { }
            foreach (Form f in _forms) { try { f.Close(); } catch { } }
            ExitThread();
        }
    }

    internal class BlackForm : Form
    {
        public BlackForm(Screen sc)
        {
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            Bounds = sc.Bounds;
            BackColor = Color.Black;
            ShowInTaskbar = false;
            TopMost = true;
            DoubleBuffered = true;
            KeyPreview = true;
            KeyDown += (s, e) => Application.Exit();
            MouseDown += (s, e) => Application.Exit();
        }
    }

    internal sealed class ClockForm : Form
    {
        private readonly Config _cfg;
        private readonly Action _quit;
        private readonly WebView2 _web = new WebView2();

        public ClockForm(Screen sc, Config cfg, Action quit)
        {
            _cfg = cfg;
            _quit = quit;

            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            Bounds = sc.Bounds;
            BackColor = Color.Black;
            ShowInTaskbar = false;
            TopMost = true;
            KeyPreview = true;

            _web.Dock = DockStyle.Fill;
            _web.DefaultBackgroundColor = Color.Black;
            Controls.Add(_web);

            KeyDown += OnFormKey;
            MouseDown += (s, e) => _quit();
        }

        private string SceneUrl()
        {
            string url = new Uri(Program.SceneFile).AbsoluteUri;
            return url + "?zoom=" + _cfg.Zoom.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture)
                       + "&ox=" + _cfg.OffsetX.ToString("0.####", System.Globalization.CultureInfo.InvariantCulture)
                       + "&oy=" + _cfg.OffsetY.ToString("0.####", System.Globalization.CultureInfo.InvariantCulture);
        }

        // WebView2 is a browser engine, and a browser engine likes to talk:
        // component updates, variations seeds, domain reliability pings, DNS
        // prediction. None of that is needed to draw a clock.
        private const string OfflineArgs =
            "--disable-background-networking " +
            "--disable-component-update " +
            "--disable-domain-reliability " +
            "--disable-sync " +
            "--disable-client-side-phishing-detection " +
            "--no-pings " +
            "--no-first-run " +
            "--disable-extensions " +
            "--disable-features=NetworkPrediction,OptimizationHints,Translate,MediaRouter,InterestFeedContentSuggestions " +
            "--host-resolver-rules=\"MAP * ~NOTFOUND\"";

        protected override async void OnShown(EventArgs e)
        {
            base.OnShown(e);
            try
            {
                // Offline by construction: the scene is a local file with every
                // texture inlined, so the engine has nothing legitimate to fetch.
                // Three independent brakes, so a Chromium feature we did not think
                // of cannot phone home: no background networking, no DNS at all,
                // and a request filter that only lets file: through.
                var opts = new CoreWebView2EnvironmentOptions(OfflineArgs);
                CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(
                    null, Path.Combine(Config.Dir, "wv2"), opts);
                await _web.EnsureCoreWebView2Async(env);

                CoreWebView2Settings st = _web.CoreWebView2.Settings;
                st.AreDefaultContextMenusEnabled = false;
                st.AreDevToolsEnabled = false;
                st.IsStatusBarEnabled = false;
                st.AreBrowserAcceleratorKeysEnabled = false;
                st.IsZoomControlEnabled = false;
                st.IsPasswordAutosaveEnabled = false;
                st.IsGeneralAutofillEnabled = false;
                st.IsSwipeNavigationEnabled = false;
                st.AreHostObjectsAllowed = false;

                _web.CoreWebView2.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
                _web.CoreWebView2.WebResourceRequested += (s2, e2) =>
                {
                    string uri = e2.Request.Uri ?? "";
                    if (uri.StartsWith("file:", StringComparison.OrdinalIgnoreCase) ||
                        uri.StartsWith("data:", StringComparison.OrdinalIgnoreCase) ||
                        uri.StartsWith("blob:", StringComparison.OrdinalIgnoreCase))
                        return;
                    e2.Response = _web.CoreWebView2.Environment.CreateWebResourceResponse(
                        null, 403, "Blocked", "");
                };

                // The WinForms wrapper has no CoreWebView2Controller, so keyboard
                // input arrives from the page itself: every key and click is
                // forwarded to the host, which either tunes the view or quits.
                await _web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(@"
                    (function () {
                      var send = function (m) {
                        try { if (window.chrome && chrome.webview) chrome.webview.postMessage(m); } catch (e) {}
                      };
                      window.addEventListener('keydown', function (e) {
                        send({ t: 'key', k: e.key });
                        if (e.key.length === 1 || e.key.indexOf('Arrow') === 0) e.preventDefault();
                      }, true);
                      window.addEventListener('pointerdown', function () { send({ t: 'click' }); }, true);
                    })();");
                _web.CoreWebView2.WebMessageReceived += OnWebMessage;
                _web.CoreWebView2.Navigate(SceneUrl());
            }
            catch (Exception ex)
            {
                // WebView2 Runtime missing: leave a black screen rather than a crash dialog.
                MessageBox.Show(
                    "The clock needs the Microsoft Edge WebView2 Runtime.\n\n" +
                    "Install it once from https://go.microsoft.com/fwlink/p/?LinkId=2124703 " +
                    "and start the screensaver again.\n\n" + ex.Message,
                    "Perfboard Screensaver", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                _quit();
            }
        }

        private void OnFormKey(object sender, KeyEventArgs e)
        {
            if (!HandleKey(e.KeyCode)) _quit();
        }

        private void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string json = e.WebMessageAsJson ?? "";
            string t = Field(json, "t") ?? "?";
            string k = Field(json, "k") ?? "";

            if (t == "click") { _quit(); return; }
            if (!HandleKeyName(k)) _quit();
        }

        // {"t":"key","k":"ArrowLeft"} - two string fields, no need for a parser.
        private static string Field(string json, string key)
        {
            Match m = Regex.Match(json, "\"" + key + "\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
            return m.Success ? Regex.Unescape(m.Groups[1].Value) : null;
        }

        private bool HandleKeyName(string k)
        {
            switch (k)
            {
                case "+": case "=": _cfg.Zoom = Config.ClampZoom(_cfg.Zoom * 1.10); break;
                case "-": case "_": _cfg.Zoom = Config.ClampZoom(_cfg.Zoom / 1.10); break;
                case "ArrowLeft": _cfg.OffsetX = Config.ClampOff(_cfg.OffsetX - 0.01); break;
                case "ArrowRight": _cfg.OffsetX = Config.ClampOff(_cfg.OffsetX + 0.01); break;
                case "ArrowUp": _cfg.OffsetY = Config.ClampOff(_cfg.OffsetY - 0.01); break;
                case "ArrowDown": _cfg.OffsetY = Config.ClampOff(_cfg.OffsetY + 0.01); break;
                case "r": case "R": _cfg.Zoom = 1.0; _cfg.OffsetX = 0.0; _cfg.OffsetY = 0.0; break;
                default: return false;
            }
            ApplyView();
            _cfg.Save();
            return true;
        }

        /// <summary>Returns false when the key should quit the screensaver.</summary>
        private bool HandleKey(Keys k)
        {
            switch (k)
            {
                case Keys.Oemplus:
                case Keys.Add:
                    _cfg.Zoom = Config.ClampZoom(_cfg.Zoom * 1.10); break;
                case Keys.OemMinus:
                case Keys.Subtract:
                    _cfg.Zoom = Config.ClampZoom(_cfg.Zoom / 1.10); break;
                case Keys.Left:
                    _cfg.OffsetX = Config.ClampOff(_cfg.OffsetX - 0.01); break;
                case Keys.Right:
                    _cfg.OffsetX = Config.ClampOff(_cfg.OffsetX + 0.01); break;
                case Keys.Up:
                    _cfg.OffsetY = Config.ClampOff(_cfg.OffsetY - 0.01); break;
                case Keys.Down:
                    _cfg.OffsetY = Config.ClampOff(_cfg.OffsetY + 0.01); break;
                case Keys.R:
                    _cfg.Zoom = 1.0; _cfg.OffsetX = 0.0; _cfg.OffsetY = 0.0; break;
                default:
                    return false;
            }
            ApplyView();
            _cfg.Save();       // survives the next start, so tuning sticks
            return true;
        }

        private async void ApplyView()
        {
            try
            {
                if (_web.CoreWebView2 == null) return;
                string js = string.Format(System.Globalization.CultureInfo.InvariantCulture,
                    "window.setView && window.setView({0}, {1}, {2});", _cfg.Zoom, _cfg.OffsetX, _cfg.OffsetY);
                await _web.CoreWebView2.ExecuteScriptAsync(js);
            }
            catch { }
        }
    }
}
