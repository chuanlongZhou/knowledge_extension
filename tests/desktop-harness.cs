using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using PKMNexus;

static class DesktopHarness {
    static void Check(bool value, string message) { if (!value) throw new Exception(message); }
    [STAThread]
    static void Main(string[] args) {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        DesktopWindow window = new DesktopWindow(args[0], false);
        window.StartPosition = FormStartPosition.Manual;
        window.Location = new Point(-32000, -32000);
        window.Shown += async delegate {
            object report;
            try {
                if (await Task.WhenAny(window.Ready, Task.Delay(25000)) != window.Ready) throw new Exception("Desktop startup timed out");
                await window.Ready;
                Label summary = (Label)window.Controls.Find("summary", true)[0];
                Check(summary.Text.Contains("0 条资料"), "Native UI did not receive the real backend status: " + summary.Text);
                Check(window.TrayVisible, "Tray icon must be visible");
                Check(window.BackendProcess.MainWindowHandle == IntPtr.Zero, "Backend must not own a terminal window");
                Button google = (Button)window.Controls.Find("google", true)[0];
                bool configured = (bool)typeof(DesktopWindow).GetField("googleConfigured", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(window);
                Check(google.Enabled && google.Text == (configured ? "登录自己的 Google" : "设置 Google 登录"), "Google button must offer login or actionable application setup");
                using (Bitmap bitmap = new Bitmap(window.Width, window.Height)) {
                    window.DrawToBitmap(bitmap, new Rectangle(Point.Empty, bitmap.Size));
                    bitmap.Save(args[2], ImageFormat.Png);
                }
                window.WindowState = FormWindowState.Minimized;
                await Task.Delay(200);
                Check(!window.Visible && !window.ShowInTaskbar && window.TrayVisible, "Minimize must hide the window and retain the tray icon");
                Check(!window.BackendProcess.HasExited, "Minimize must retain the local service");
                NotifyIcon tray = (NotifyIcon)typeof(DesktopWindow).GetField("tray", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(window);
                tray.ContextMenuStrip.Items[0].PerformClick();
                Check(window.Visible && window.WindowState == FormWindowState.Normal && window.ShowInTaskbar, "Tray menu must restore the window");
                window.Close();
                Check(!window.IsDisposed && !window.Visible && window.TrayVisible, "Close button must minimize to the tray");
                tray.ContextMenuStrip.Items[0].PerformClick();
                bool created;
                using (Mutex mutex = new Mutex(true, "Local\\PKMNexusDesktop-" + DesktopApp.ProfileKey(), out created)) {
                    Check(created, "Test profile must not have an existing application instance");
                    try {
                        using (EventWaitHandle signal = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\PKMNexusShow-" + DesktopApp.ProfileKey()))
                        using (Process duplicate = Process.Start(new ProcessStartInfo(args[3], "--open") { UseShellExecute = false, CreateNoWindow = true })) {
                            Check(await Task.Run(() => duplicate.WaitForExit(5000)), "Second launch should return to the existing instance");
                            Check(await Task.Run(() => signal.WaitOne(1000)), "Second launch must signal the existing window");
                            Check(duplicate.ExitCode == 0, "Duplicate launcher failed");
                        }
                    } finally { mutex.ReleaseMutex(); }
                }
                int backendId = window.BackendProcess.Id;
                await window.ExitApplication();
                bool alive;
                try { using (Process process = Process.GetProcessById(backendId)) alive = !process.HasExited; }
                catch (ArgumentException) { alive = false; }
                Check(!alive, "Exit must stop the owned backend process");
                report = new { status = "passed", statusFromRealBackend = true, noConsole = true, trayIcon = true, minimizeToTray = true, restoreFromMenu = true, closeToTray = true, singleInstance = true, exitStopsBackend = true };
            } catch (Exception error) {
                report = new { status = "failed", error = error.ToString() };
                Environment.ExitCode = 1;
            }
            if (!window.IsDisposed) await window.ExitApplication();
            File.WriteAllText(args[1], new JavaScriptSerializer().Serialize(report));
        };
        Application.Run(window);
    }
}
