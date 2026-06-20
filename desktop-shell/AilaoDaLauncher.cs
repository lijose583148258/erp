using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text;
using System.Windows.Forms;

namespace AilaoDaDesktopShell
{
    internal static class Program
    {
        private const string AppUrl = "http://127.0.0.1:5001/";

        [STAThread]
        private static void Main(string[] args)
        {
            try { Console.OutputEncoding = Encoding.UTF8; } catch { }
            var shell = new ShellRuntime();

            if (args.Length > 0)
            {
                Environment.ExitCode = HandleCli(shell, args);
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new LauncherForm(shell));
        }

        private static int HandleCli(ShellRuntime shell, string[] args)
        {
            var command = args[0].Trim().ToLowerInvariant();
            try
            {
                if (command == "--print-config")
                {
                    shell.WriteAuditReport("print-config", "passed", "configuration exported", 0, shell.BuildConfigJson());
                    return 0;
                }
                if (command == "--start")
                {
                    var result = shell.RunScript(shell.StartScript, 300000);
                    shell.WriteAuditReport("start", result.ExitCode == 0 ? "passed" : "failed", result.Output, result.ExitCode, shell.BuildConfigJson());
                    return result.ExitCode;
                }
                if (command == "--stop")
                {
                    var result = shell.RunScript(shell.StopScript, 300000);
                    shell.WriteAuditReport("stop", result.ExitCode == 0 ? "passed" : "failed", result.Output, result.ExitCode, shell.BuildConfigJson());
                    return result.ExitCode;
                }
                if (command == "--health")
                {
                    var result = shell.RunScript(shell.CheckScript, 90000);
                    shell.WriteAuditReport("health", result.ExitCode == 0 ? "passed" : "failed", result.Output, result.ExitCode, shell.BuildConfigJson());
                    return result.ExitCode;
                }
                if (command == "--open")
                {
                    shell.OpenBrowser();
                    shell.WriteAuditReport("open", "passed", "browser open requested", 0, shell.BuildConfigJson());
                    return 0;
                }

                shell.WriteAuditReport(command, "failed", "unknown command", 2, shell.BuildConfigJson());
                return 2;
            }
            catch (Exception ex)
            {
                shell.WriteAuditReport(command, "failed", ex.ToString(), 1, shell.BuildConfigJson());
                return 1;
            }
        }
    }

    internal sealed class ShellRuntime
    {
        public readonly string PackageRoot;
        public readonly string StartScript;
        public readonly string StopScript;
        public readonly string CheckScript;
        public readonly string AuditReport;

        public ShellRuntime()
        {
            PackageRoot = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            StartScript = Path.Combine(PackageRoot, "scripts", "start-stable-v2.ps1");
            StopScript = Path.Combine(PackageRoot, "scripts", "stop-runtime.ps1");
            CheckScript = Path.Combine(PackageRoot, "scripts", "check-runtime.ps1");
            AuditReport = Path.Combine(PackageRoot, "output", "audit", "desktop-shell-v1.json");
        }

        public ScriptResult RunScript(string scriptPath, int timeoutMs)
        {
            if (!File.Exists(scriptPath))
            {
                return new ScriptResult(1, "Missing script: " + scriptPath);
            }

            var startInfo = new ProcessStartInfo();
            startInfo.FileName = "powershell.exe";
            startInfo.Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + scriptPath + "\"";
            startInfo.WorkingDirectory = PackageRoot;
            startInfo.UseShellExecute = false;
            startInfo.RedirectStandardOutput = true;
            startInfo.RedirectStandardError = true;
            startInfo.CreateNoWindow = true;
            startInfo.StandardOutputEncoding = Encoding.UTF8;
            startInfo.StandardErrorEncoding = Encoding.UTF8;

            using (var process = new Process())
            {
                process.StartInfo = startInfo;
                var output = new StringBuilder();
                process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
                {
                    if (e.Data != null) output.AppendLine(e.Data);
                };
                process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
                {
                    if (e.Data != null) output.AppendLine(e.Data);
                };

                process.Start();
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();

                if (!process.WaitForExit(timeoutMs))
                {
                    try { process.Kill(); } catch { }
                    return new ScriptResult(124, "Script timed out after " + timeoutMs + "ms: " + scriptPath + Environment.NewLine + output.ToString());
                }
                process.WaitForExit();
                return new ScriptResult(process.ExitCode, output.ToString());
            }
        }

        public bool ProbeHealth(out string message)
        {
            try
            {
                var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:5001/api/health");
                request.Method = "GET";
                request.Timeout = 5000;
                request.ReadWriteTimeout = 5000;
                using (var response = (HttpWebResponse)request.GetResponse())
                {
                    message = "HTTP " + (int)response.StatusCode + " " + response.StatusDescription;
                    return (int)response.StatusCode >= 200 && (int)response.StatusCode < 300;
                }
            }
            catch (Exception ex)
            {
                message = ex.Message;
                return false;
            }
        }

        public void OpenBrowser()
        {
            var startInfo = new ProcessStartInfo();
            startInfo.FileName = "http://127.0.0.1:5001/";
            startInfo.UseShellExecute = true;
            Process.Start(startInfo);
        }

        public string BuildConfigJson()
        {
            return "{"
                + "\"packageRoot\":\"" + JsonEscape(PackageRoot) + "\","
                + "\"entryUrl\":\"http://127.0.0.1:5001/\","
                + "\"runtimeDb\":\"D:/AilaoDaRuntime/stable.db\","
                + "\"startScriptExists\":" + JsonBool(File.Exists(StartScript)) + ","
                + "\"stopScriptExists\":" + JsonBool(File.Exists(StopScript)) + ","
                + "\"checkScriptExists\":" + JsonBool(File.Exists(CheckScript))
                + "}";
        }

        public void WriteAuditReport(string command, string status, string message, int exitCode, string configJson)
        {
            var dir = Path.GetDirectoryName(AuditReport);
            if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
            var json = "{"
                + "\"name\":\"AilaoDa Desktop Shell\","
                + "\"version\":\"1.0\","
                + "\"generatedAt\":\"" + DateTime.UtcNow.ToString("o") + "\","
                + "\"command\":\"" + JsonEscape(command) + "\","
                + "\"status\":\"" + JsonEscape(status) + "\","
                + "\"exitCode\":" + exitCode + ","
                + "\"message\":\"" + JsonEscape(TrimForJson(message, 8000)) + "\","
                + "\"config\":" + configJson
                + "}";
            File.WriteAllText(AuditReport, json + Environment.NewLine, new UTF8Encoding(false));
        }

        private static string TrimForJson(string value, int max)
        {
            if (String.IsNullOrEmpty(value)) return "";
            if (value.Length <= max) return value;
            return value.Substring(value.Length - max, max);
        }

        private static string JsonBool(bool value)
        {
            return value ? "true" : "false";
        }

        private static string JsonEscape(string value)
        {
            if (value == null) return "";
            return value
                .Replace("\\", "\\\\")
                .Replace("\"", "\\\"")
                .Replace("\r", "\\r")
                .Replace("\n", "\\n")
                .Replace("\t", "\\t");
        }
    }

    internal sealed class ScriptResult
    {
        public readonly int ExitCode;
        public readonly string Output;

        public ScriptResult(int exitCode, string output)
        {
            ExitCode = exitCode;
            Output = output ?? "";
        }
    }

    internal sealed class LauncherForm : Form
    {
        private readonly ShellRuntime runtime;
        private readonly Label statusLabel;
        private readonly TextBox logBox;
        private readonly Button startButton;
        private readonly Button openButton;
        private readonly Button healthButton;
        private readonly Button stopButton;

        public LauncherForm(ShellRuntime runtime)
        {
            this.runtime = runtime;
            Text = "\u7231\u52b3\u8fbe ERP+CRM \u672c\u5730\u7a33\u5b9a\u58f3";
            Width = 780;
            Height = 560;
            MinimumSize = new Size(720, 500);
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Regular, GraphicsUnit.Point);
            BackColor = Color.FromArgb(245, 248, 255);

            var hero = new Panel();
            hero.Dock = DockStyle.Top;
            hero.Height = 148;
            hero.BackColor = Color.FromArgb(17, 31, 64);
            Controls.Add(hero);

            var title = new Label();
            title.Text = "\u7231\u52b3\u8fbe ERP+CRM";
            title.ForeColor = Color.White;
            title.Font = new Font("Microsoft YaHei UI", 22F, FontStyle.Bold, GraphicsUnit.Point);
            title.AutoSize = true;
            title.Location = new Point(28, 24);
            hero.Controls.Add(title);

            var subtitle = new Label();
            subtitle.Text = "\u672c\u5730\u7a33\u5b9a\u5305\u684c\u9762\u58f3  |  \u53ea\u542f\u52a8 127.0.0.1:5001  |  \u6570\u636e\u5e93 D:\\AilaoDaRuntime\\stable.db";
            subtitle.ForeColor = Color.FromArgb(201, 213, 238);
            subtitle.Font = new Font("Microsoft YaHei UI", 10F, FontStyle.Regular, GraphicsUnit.Point);
            subtitle.AutoSize = true;
            subtitle.Location = new Point(31, 73);
            hero.Controls.Add(subtitle);

            statusLabel = new Label();
            statusLabel.Text = "\u72b6\u6001\uff1a\u5f85\u68c0\u67e5";
            statusLabel.ForeColor = Color.FromArgb(29, 47, 89);
            statusLabel.Font = new Font("Microsoft YaHei UI", 11F, FontStyle.Bold, GraphicsUnit.Point);
            statusLabel.AutoSize = true;
            statusLabel.Location = new Point(32, 169);
            Controls.Add(statusLabel);

            startButton = MakeButton("\u542f\u52a8\u7cfb\u7edf", 32, 215, Color.FromArgb(37, 99, 235), Color.White);
            openButton = MakeButton("\u6253\u5f00\u5de5\u4f5c\u53f0", 202, 215, Color.FromArgb(16, 185, 129), Color.White);
            healthButton = MakeButton("\u5065\u5eb7\u68c0\u67e5", 372, 215, Color.FromArgb(255, 255, 255), Color.FromArgb(29, 47, 89));
            stopButton = MakeButton("\u5b89\u5168\u505c\u6b62", 542, 215, Color.FromArgb(255, 255, 255), Color.FromArgb(185, 28, 28));

            startButton.Click += delegate { RunUiAction("\u542f\u52a8\u7cfb\u7edf", runtime.StartScript, 300000, true); };
            openButton.Click += delegate { runtime.OpenBrowser(); AppendLog("\u5df2\u8bf7\u6c42\u6253\u5f00 http://127.0.0.1:5001/"); };
            healthButton.Click += delegate { RefreshHealth(); };
            stopButton.Click += delegate { RunUiAction("\u5b89\u5168\u505c\u6b62", runtime.StopScript, 300000, false); };

            logBox = new TextBox();
            logBox.Multiline = true;
            logBox.ReadOnly = true;
            logBox.ScrollBars = ScrollBars.Vertical;
            logBox.BorderStyle = BorderStyle.None;
            logBox.BackColor = Color.White;
            logBox.ForeColor = Color.FromArgb(30, 41, 59);
            logBox.Font = new Font("Consolas", 9F, FontStyle.Regular, GraphicsUnit.Point);
            logBox.Location = new Point(32, 285);
            logBox.Width = 700;
            logBox.Height = 190;
            Controls.Add(logBox);

            var footer = new Label();
            footer.Text = "\u8bf7\u4f7f\u7528\u672c\u58f3\u6240\u5728\u76ee\u5f55\u7684\u542f\u52a8\u7cfb\u7edf.bat\uff0c\u4e0d\u8981\u4ece\u65e7\u5165\u53e3\u542f\u52a8\u3002";
            footer.ForeColor = Color.FromArgb(100, 116, 139);
            footer.AutoSize = true;
            footer.Location = new Point(32, 494);
            Controls.Add(footer);

            Shown += delegate { RefreshHealth(); };
        }

        private Button MakeButton(string text, int x, int y, Color back, Color fore)
        {
            var button = new Button();
            button.Text = text;
            button.Left = x;
            button.Top = y;
            button.Width = 140;
            button.Height = 44;
            button.FlatStyle = FlatStyle.Flat;
            button.FlatAppearance.BorderColor = Color.FromArgb(218, 226, 240);
            button.BackColor = back;
            button.ForeColor = fore;
            button.Font = new Font("Microsoft YaHei UI", 10F, FontStyle.Bold, GraphicsUnit.Point);
            Controls.Add(button);
            return button;
        }

        private void SetBusy(bool busy)
        {
            startButton.Enabled = !busy;
            openButton.Enabled = !busy;
            healthButton.Enabled = !busy;
            stopButton.Enabled = !busy;
            Cursor = busy ? Cursors.WaitCursor : Cursors.Default;
        }

        private void RunUiAction(string label, string script, int timeoutMs, bool openAfterSuccess)
        {
            SetBusy(true);
            AppendLog("[" + DateTime.Now.ToString("HH:mm:ss") + "] " + label + "...");
            var result = runtime.RunScript(script, timeoutMs);
            AppendLog(result.Output);
            AppendLog(label + " exitCode=" + result.ExitCode);
            SetBusy(false);
            RefreshHealth();
            if (openAfterSuccess && result.ExitCode == 0)
            {
                runtime.OpenBrowser();
            }
        }

        private void RefreshHealth()
        {
            string message;
            var ok = runtime.ProbeHealth(out message);
            statusLabel.Text = ok ? "\u72b6\u6001\uff1a\u8fd0\u884c\u6b63\u5e38  " + message : "\u72b6\u6001\uff1a\u672a\u8fde\u901a  " + message;
            statusLabel.ForeColor = ok ? Color.FromArgb(21, 128, 61) : Color.FromArgb(185, 28, 28);
            AppendLog("health: " + message);
        }

        private void AppendLog(string text)
        {
            if (String.IsNullOrEmpty(text)) return;
            logBox.AppendText(text.TrimEnd() + Environment.NewLine);
        }
    }
}
