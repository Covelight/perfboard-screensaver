// /c — the settings dialog Windows shows for the screensaver.
using System;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;

namespace PerfboardSaver
{
    internal sealed class SettingsForm : Form
    {
        private readonly Config _cfg;
        private readonly ComboBox _monitors = new ComboBox();
        private readonly TrackBar _zoom = new TrackBar();
        private readonly TrackBar _ox = new TrackBar();
        private readonly TrackBar _oy = new TrackBar();
        private readonly Label _zoomVal = new Label();
        private readonly Label _xVal = new Label();
        private readonly Label _yVal = new Label();

        public SettingsForm()
        {
            _cfg = Config.Load();

            Text = "Perfboard Clock — Screen Saver Settings";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(560, 372);
            BackColor = Color.FromArgb(18, 18, 20);
            ForeColor = Color.FromArgb(230, 230, 234);
            Font = new Font("Segoe UI", 9.5f);

            int y = 18;
            AddLabel("Show the clock on", 18, y); y += 26;

            _monitors.DropDownStyle = ComboBoxStyle.DropDownList;
            _monitors.Bounds = new Rectangle(18, y, 520, 26);
            _monitors.Items.Add("Middle monitor (auto)");
            _monitors.Items.Add("Primary monitor");
            _monitors.Items.Add("Left-most monitor");
            _monitors.Items.Add("Right-most monitor");
            foreach (Screen sc in Screen.AllScreens.OrderBy(s => s.Bounds.Left))
                _monitors.Items.Add(string.Format("Monitor {0}  ({1} × {2})",
                    sc.Bounds.Left + sc.Bounds.Width / 2, sc.Bounds.Width, sc.Bounds.Height));
            _monitors.SelectedIndex = MonitorIndex(_cfg.Monitor);
            Controls.Add(_monitors);
            y += 36;

            AddLabel("Every other monitor stays pure black.", 18, y, Color.FromArgb(140, 140, 148)); y += 28;

            AddSlider("Scale", _zoom, 15, 600, y, (int)Math.Round(_cfg.Zoom * 100), _zoomVal,
                v => { _zoomVal.Text = v + " %"; });
            y += 58;
            AddSlider("Move horizontally", _ox, -50, 50, y, (int)Math.Round(_cfg.OffsetX * 100), _xVal,
                v => { _xVal.Text = (v > 0 ? "+" : "") + v + " %"; });
            y += 58;
            AddSlider("Move vertically", _oy, -50, 50, y, (int)Math.Round(_cfg.OffsetY * 100), _yVal,
                v => { _yVal.Text = (v > 0 ? "+" : "") + v + " %"; });
            y += 62;

            AddLabel("100 % fits the board to the screen. While the saver runs you can also use\n" +
                     "+ / − to scale, the arrow keys to move, R to reset — that always quits and saves.",
                     18, y, Color.FromArgb(140, 140, 148));
            y += 52;

            var ok = new Button { Text = "Save", Bounds = new Rectangle(346, y, 92, 30), DialogResult = DialogResult.OK };
            var cancel = new Button { Text = "Cancel", Bounds = new Rectangle(446, y, 92, 30), DialogResult = DialogResult.Cancel };
            var reset = new Button { Text = "Reset", Bounds = new Rectangle(18, y, 92, 30) };
            reset.Click += (s, e) =>
            {
                _zoom.Value = 100; _ox.Value = 0; _oy.Value = 0; _monitors.SelectedIndex = 0;
            };
            ok.Click += (s, e) => Save();
            Controls.AddRange(new Control[] { ok, cancel, reset });
            AcceptButton = ok;
            CancelButton = cancel;
        }

        private void AddLabel(string text, int x, int y) =>
            AddLabel(text, x, y, Color.FromArgb(230, 230, 234));

        private void AddLabel(string text, int x, int y, Color c)
        {
            Controls.Add(new Label
            {
                Text = text, Bounds = new Rectangle(x, y, 524, 40),
                ForeColor = c, AutoSize = false
            });
        }

        private void AddSlider(string name, TrackBar tb, int min, int max, int y, int value,
                               Label readout, Action<int> onValue)
        {
            Controls.Add(new Label { Text = name, Bounds = new Rectangle(18, y + 6, 150, 22) });
            tb.Minimum = min; tb.Maximum = max; tb.TickStyle = TickStyle.None;
            tb.Bounds = new Rectangle(170, y, 300, 34);
            tb.Value = Math.Max(min, Math.Min(max, value));
            readout.Bounds = new Rectangle(478, y + 6, 64, 22);
            readout.TextAlign = ContentAlignment.MiddleRight;
            onValue(tb.Value);
            tb.ValueChanged += (s, e) => onValue(tb.Value);
            Controls.AddRange(new Control[] { tb, readout });
        }

        private static int MonitorIndex(string mode)
        {
            switch ((mode ?? "middle").Trim().ToLowerInvariant())
            {
                case "primary": return 1;
                case "left": return 2;
                case "right": return 3;
                default:
                    if (int.TryParse(mode, out int i) && i >= 0 && i < Screen.AllScreens.Length) return 4 + i;
                    return 0;
            }
        }

        private string MonitorMode()
        {
            switch (_monitors.SelectedIndex)
            {
                case 1: return "primary";
                case 2: return "left";
                case 3: return "right";
                case 0: return "middle";
                default: return (_monitors.SelectedIndex - 4).ToString();
            }
        }

        private void Save()
        {
            _cfg.Monitor = MonitorMode();
            _cfg.Zoom = Config.ClampZoom(_zoom.Value / 100.0);
            _cfg.OffsetX = Config.ClampOff(_ox.Value / 100.0);
            _cfg.OffsetY = Config.ClampOff(_oy.Value / 100.0);
            _cfg.Save();
        }
    }
}
