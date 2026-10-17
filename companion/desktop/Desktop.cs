using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace PKMNexus {
    public static class DesktopApp {
        public static string ProfileKey() {
            string home = Environment.GetEnvironmentVariable("PKM_NEXUS_HOME");
            if (String.IsNullOrEmpty(home)) home = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PKM Nexus");
            using (SHA256 hash = SHA256.Create())
                return BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(Path.GetFullPath(home).ToUpperInvariant()))).Replace("-", "").Substring(0, 24);
        }
        [STAThread]
        public static void Main(string[] args) {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            if (Array.IndexOf(args, "--sync") >= 0) {
                try {
                    using (Process process = new Process { StartInfo = AppRuntime.StartInfo(AppRuntime.Root, Array.IndexOf(args, "--scheduled") >= 0 ? "--sync --scheduled" : "--sync") }) {
                        process.Start(); Task<string> error = process.StandardError.ReadToEndAsync(); Task<string> output = process.StandardOutput.ReadToEndAsync();
                        process.WaitForExit(); Task.WaitAll(error, output); Environment.ExitCode = process.ExitCode;
                    }
                } catch { Environment.ExitCode = 1; }
                return;
            }
            bool created;
            using (Mutex mutex = new Mutex(true, "Local\\PKMNexusDesktop-" + ProfileKey(), out created)) {
                if (!created) {
                    try { using (EventWaitHandle signal = EventWaitHandle.OpenExisting("Local\\PKMNexusShow-" + ProfileKey())) signal.Set(); }
                    catch (WaitHandleCannotBeOpenedException) { }
                    return;
                }
                try {
                    using (DesktopWindow window = new DesktopWindow(AppRuntime.Root, Array.IndexOf(args, "--tray") >= 0))
                    using (EventWaitHandle show = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\PKMNexusShow-" + ProfileKey()))
                    using (EventWaitHandle quit = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\PKMNexusQuit-" + ProfileKey())) {
                        window.CreateControl();
                        IntPtr handle = window.Handle;
                        RegisteredWaitHandle showWait = ThreadPool.RegisterWaitForSingleObject(show, delegate {
                            if (!window.IsDisposed) { try { window.BeginInvoke(new Action(window.RestoreWindow)); } catch (InvalidOperationException) { } }
                        }, null, Timeout.Infinite, false);
                        RegisteredWaitHandle quitWait = ThreadPool.RegisterWaitForSingleObject(quit, delegate {
                            if (!window.IsDisposed) { try { window.BeginInvoke(new Action(async delegate { await window.ExitApplication(); })); } catch (InvalidOperationException) { } }
                        }, null, Timeout.Infinite, false);
                        try { Application.Run(window); }
                        finally { showWait.Unregister(null); quitWait.Unregister(null); }
                    }
                } finally { mutex.ReleaseMutex(); }
            }
        }
        public static Icon AppIcon() {
            using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("nexus.ico"))
            using (Icon icon = new Icon(stream)) return (Icon)icon.Clone();
        }
    }

    public sealed class LocalApi {
        readonly string origin;
        readonly CookieContainer cookies = new CookieContainer();
        readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 8 * 1024 * 1024 };
        public LocalApi(string address) {
            Uri uri = new Uri(address);
            if (uri.Scheme != "http" || uri.Host != "127.0.0.1" || uri.Port < 1 || uri.AbsolutePath != "/" || uri.Fragment.Length < 30)
                throw new Exception("本地管理地址无效。");
            origin = uri.GetLeftPart(UriPartial.Authority);
            Bootstrap = Uri.UnescapeDataString(uri.Fragment.Substring(1));
        }
        public string Bootstrap { get; private set; }
        async Task<Dictionary<string, object>> Post(string path, string body, string bootstrap) {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(origin + path);
            request.Proxy = null;
            request.Method = "POST";
            request.CookieContainer = cookies;
            request.Headers["Origin"] = origin;
            request.ContentType = "application/json";
            request.Timeout = 180000;
            if (bootstrap != null) request.Headers["X-PKM-Bootstrap"] = bootstrap;
            byte[] bytes = Encoding.UTF8.GetBytes(body);
            request.ContentLength = bytes.Length;
            using (Stream output = await request.GetRequestStreamAsync()) await output.WriteAsync(bytes, 0, bytes.Length);
            WebResponse reply;
            bool failed = false;
            try { reply = await request.GetResponseAsync(); }
            catch (WebException error) {
                if (error.Response == null) throw new Exception("无法连接本地服务，请重新打开应用。");
                reply = error.Response; failed = true;
            }
            using (WebResponse response = reply)
            using (StreamReader input = new StreamReader(response.GetResponseStream(), Encoding.UTF8)) {
                string content = await input.ReadToEndAsync();
                if (failed) {
                    string message = "本地服务请求失败，请重新打开应用。";
                    try {
                        Dictionary<string, object> data = json.Deserialize<Dictionary<string, object>>(content);
                        if (data.ContainsKey("error")) message = Convert.ToString(data["error"]);
                    } catch (ArgumentException) { }
                    throw new Exception(message);
                }
                return json.Deserialize<Dictionary<string, object>>(content);
            }
        }
        public async Task Login() { await Post("/session", "{}", Bootstrap); Bootstrap = null; }
        public async Task<object> Call(string command, object payload = null) {
            Dictionary<string, object> result = await Post("/api", json.Serialize(new { command, payload = payload ?? new { } }), null);
            if (!Convert.ToBoolean(result["ok"])) throw new Exception(Convert.ToString(result["error"]));
            return result["result"];
        }
        public void OpenBrowser(string address) {
            Uri uri = new Uri(address);
            if (!((uri.Scheme == "https" && uri.Host == "accounts.google.com") || uri.GetLeftPart(UriPartial.Authority) == origin))
                throw new Exception("无法打开此地址。");
            Process.Start(new ProcessStartInfo(address) { UseShellExecute = true });
        }
    }

    public sealed class DesktopWindow : Form {
        readonly string applicationRoot;
        readonly bool startHidden;
        readonly NotifyIcon tray;
        readonly System.Windows.Forms.Timer timer;
        readonly Label account, summary, syncStatus, folder, message;
        readonly Button sync, google, manage, restart;
        readonly TaskCompletionSource<bool> ready = new TaskCompletionSource<bool>();
        LocalApi api;
        Process backend;
        bool exiting, busy, refreshing, started, googleConfigured, canSync;
        readonly StringBuilder errors = new StringBuilder();
        public Task Ready { get { return ready.Task; } }
        public Process BackendProcess { get { return backend; } }
        public bool TrayVisible { get { return tray.Visible; } }
        public DesktopWindow(string root, bool hidden) {
            applicationRoot = root; startHidden = hidden;
            Text = "PKM Nexus · 同步助手"; Name = "PKMNexusDesktop";
            Icon = DesktopApp.AppIcon(); Font = new Font("Microsoft YaHei UI", 9F);
            AutoScaleDimensions = new SizeF(96F, 96F); AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(500, 440); FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false; StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(248, 249, 245);
            FlowLayoutPanel body = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, Padding = new Padding(24, 20, 24, 12) };
            Controls.Add(body);
            Label title = MakeLabel("PKM Nexus", 27, "title"); title.Font = new Font(Font.FontFamily, 17F, FontStyle.Bold); title.ForeColor = Color.FromArgb(40, 95, 73); body.Controls.Add(title);
            body.Controls.Add(MakeLabel("本地资料库与 Google Drive 同步助手", 28, "subtitle"));
            account = MakeLabel("Google Drive：尚未登录", 38, "account"); body.Controls.Add(account);
            summary = MakeLabel("正在启动本地服务…", 27, "summary"); body.Controls.Add(summary);
            syncStatus = MakeLabel("", 44, "sync-status"); body.Controls.Add(syncStatus);
            folder = MakeLabel("", 42, "vault-path"); folder.ForeColor = Color.DimGray; body.Controls.Add(folder);
            FlowLayoutPanel actions = new FlowLayoutPanel { Width = 452, Height = 48, Margin = new Padding(0, 8, 0, 0) };
            google = MakeButton("登录自己的 Google", "google"); google.Width = 190;
            sync = MakeButton("立即同步", "sync"); sync.BackColor = Color.FromArgb(40, 95, 73); sync.ForeColor = Color.White; sync.Width = 130;
            actions.Controls.Add(google); actions.Controls.Add(sync); body.Controls.Add(actions);
            FlowLayoutPanel secondary = new FlowLayoutPanel { Width = 452, Height = 42, Margin = new Padding(0) };
            manage = MakeButton("设置与资料管理", "manage"); manage.Width = 164;
            Button hide = MakeButton("最小化到托盘", "hide"); hide.Width = 156;
            secondary.Controls.Add(manage); secondary.Controls.Add(hide); body.Controls.Add(secondary);
            message = MakeLabel("关闭或最小化窗口后，仍会留在右下角托盘。", 46, "message"); message.ForeColor = Color.DimGray; body.Controls.Add(message);
            restart = MakeButton("重试启动", "restart"); restart.Visible = false; body.Controls.Add(restart);
            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Items.Add("打开小窗口", null, delegate { RestoreWindow(); });
            menu.Items.Add("立即同步", null, async delegate { await Synchronize(); });
            menu.Items.Add("设置与资料管理", null, async delegate { await OpenManagement(); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("退出同步助手", null, async delegate { await ExitApplication(); });
            tray = new NotifyIcon { Icon = Icon, Visible = true, Text = "PKM Nexus · 正在启动", ContextMenuStrip = menu };
            tray.DoubleClick += delegate { RestoreWindow(); };
            hide.Click += delegate { MinimizeToTray(); };
            google.Click += async delegate { await SignIn(); };
            sync.Click += async delegate { await Synchronize(); };
            manage.Click += async delegate { await OpenManagement(); };
            restart.Click += async delegate { await StartBackend(); };
            timer = new System.Windows.Forms.Timer { Interval = 5000 };
            timer.Tick += async delegate { await RefreshStatus(); };
            Shown += async delegate { if (startHidden) MinimizeToTray(); await StartBackend(); };
            Resize += delegate { if (WindowState == FormWindowState.Minimized) MinimizeToTray(); };
            FormClosing += delegate(object sender, FormClosingEventArgs e) {
                if (!exiting && e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; MinimizeToTray(); }
            };
            SetButtons(false);
        }
        static Label MakeLabel(string text, int height, string name) {
            return new Label { Text = text, Name = name, Width = 452, Height = height, Margin = new Padding(0, 4, 0, 0), AutoEllipsis = true };
        }
        static Button MakeButton(string text, string name) {
            return new Button { Text = text, Name = name, Height = 35, FlatStyle = FlatStyle.Flat, Margin = new Padding(0, 0, 10, 0), UseVisualStyleBackColor = false, BackColor = Color.White, Cursor = Cursors.Hand };
        }
        void SetButtons(bool enabled) {
            google.Enabled = enabled && !busy;
            sync.Enabled = enabled && !busy && canSync;
            manage.Enabled = enabled && !busy;
        }
        void Error(string text) { message.Text = text; message.ForeColor = Color.FromArgb(164, 60, 55); tray.Text = "PKM Nexus · 需要处理"; }
        public void RestoreWindow() { ShowInTaskbar = true; Show(); WindowState = FormWindowState.Normal; Activate(); }
        public void MinimizeToTray() { ShowInTaskbar = false; Hide(); }
        async Task StartBackend() {
            if (started || exiting) return;
            started = true; restart.Visible = false;
            try {
                backend = new Process { StartInfo = AppRuntime.StartInfo(applicationRoot, "--serve") };
                backend.StartInfo.EnvironmentVariables["PKM_NEXUS_DESKTOP_PARENT"] = Process.GetCurrentProcess().Id.ToString();
                backend.EnableRaisingEvents = true;
                Process owned = backend;
                backend.Exited += delegate {
                    if (IsDisposed || exiting) return;
                    try { BeginInvoke(new Action(async delegate {
                        if (exiting || !Object.ReferenceEquals(backend, owned)) return;
                        if (owned.ExitCode == 0) { await ExitApplication(); return; }
                        timer.Stop(); api = null; started = false; SetButtons(false); restart.Visible = true;
                        Error("本地服务已停止，请点击重试启动。资料仍保存在本机。");
                    })); } catch (InvalidOperationException) { }
                };
                backend.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null && errors.Length < 4000) errors.AppendLine(e.Data); };
                backend.Start(); backend.BeginErrorReadLine();
                Task<string> line = backend.StandardOutput.ReadLineAsync();
                if (await Task.WhenAny(line, Task.Delay(20000)) != line) throw new Exception("本地服务启动超时，请重试。");
                string value = await line;
                if (String.IsNullOrEmpty(value)) throw new Exception("本地服务未能启动。" + errors.ToString());
                Dictionary<string, object> data = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(value);
                api = new LocalApi(Convert.ToString(data["url"]));
                await api.Login();
                await RefreshStatus();
                if (summary.Text == "正在启动本地服务…") throw new Exception(message.Text);
                timer.Start(); SetButtons(true); ready.TrySetResult(true);
            } catch (Exception error) {
                Error(error.Message); started = false; restart.Visible = true;
                if (backend != null) { try { if (!backend.HasExited) backend.Kill(); } catch (InvalidOperationException) { } }
                ready.TrySetException(error);
            }
        }
        public async Task RefreshStatus() {
            if (api == null || refreshing || exiting) return;
            refreshing = true;
            try {
                Dictionary<string, object> status = (Dictionary<string, object>)await api.Call("status");
                Text = "PKM Nexus · 同步助手 " + Convert.ToString(status["version"]);
                Dictionary<string, object> auth = (Dictionary<string, object>)status["google"];
                Dictionary<string, object> user = auth["account"] as Dictionary<string, object>;
                bool connected = Convert.ToBoolean(auth["connected"]);
                googleConfigured = Convert.ToBoolean(auth["configured"]);
                account.Text = connected ? "Google Drive：" + (user == null ? "已授权，请重新登录以显示账号" : Convert.ToString(user["email"]) + "（自己的账号）") : "Google Drive：尚未登录自己的账号";
                google.Text = !googleConfigured ? "设置 Google 登录" : connected ? "切换 / 重新登录 Google" : "登录自己的 Google";
                summary.Text = String.Format("{0} 条资料 · 待上传 {1} 条 · 已连接 {2} 个扩展", status["total"], status["pendingUploads"], ((System.Collections.ICollection)status["origins"]).Count);
                folder.Text = "本地目录：" + Convert.ToString(status["vaultPath"]);
                Dictionary<string, object> binding = status["binding"] as Dictionary<string, object>;
                canSync = connected && binding != null && (user == null || !binding.ContainsKey("accountId") || Convert.ToString(binding["accountId"]) == Convert.ToString(user["id"]));
                Dictionary<string, object> last = status["lastSync"] as Dictionary<string, object>;
                Dictionary<string, object> failure = status["lastError"] as Dictionary<string, object>;
                syncStatus.Text = failure != null ? "上次同步失败：" + Convert.ToString(failure["message"]) : last != null ? "上次同步：" + Convert.ToString(last["at"]) : "资料保存在本机，尚未完成云端同步。";
                if (!busy) {
                    if (!Convert.ToBoolean(auth["configured"])) {
                        message.Text = "应用尚未配置 Google 登录。点击“设置 Google 登录”查看配置入口；应用开发者只需配置一次。";
                        message.ForeColor = Color.DimGray;
                    } else if (binding != null && user != null && binding.ContainsKey("accountId") && Convert.ToString(binding["accountId"]) != Convert.ToString(user["id"])) {
                        Error("当前账号与本地资料库不同，云端同步已停止。请登录原账号或选择另一个本地资料库。");
                    } else if (connected && binding == null) {
                        message.Text = "已登录自己的账号。请打开设置，创建或选择这个账号的 Drive 资料库。"; message.ForeColor = Color.DimGray;
                    } else { message.Text = "关闭或最小化窗口后，仍会留在右下角托盘。"; message.ForeColor = Color.DimGray; }
                }
                tray.Text = failure == null ? "PKM Nexus · 待上传 " + Convert.ToString(status["pendingUploads"]) + " 条" : "PKM Nexus · 同步失败";
                SetButtons(true);
            } catch (Exception error) { Error(error.Message); }
            finally { refreshing = false; }
        }
        async Task SignIn() {
            if (api == null || busy) return;
            if (!googleConfigured) { await OpenManagement(); return; }
            busy = true; SetButtons(false);
            try {
                Dictionary<string, object> result = (Dictionary<string, object>)await api.Call("google.connect");
                api.OpenBrowser(Convert.ToString(result["url"]));
                message.Text = "请在系统浏览器选择自己的 Google 账号并授权。"; message.ForeColor = Color.DimGray;
            } catch (Exception error) { Error(error.Message); RestoreWindow(); }
            finally { busy = false; SetButtons(true); }
        }
        async Task Synchronize() {
            if (api == null || busy) return;
            if (!canSync) { RestoreWindow(); Error("请先登录自己的 Google 账号，并在设置中选择对应的 Drive 资料库。"); return; }
            busy = true; SetButtons(false); syncStatus.Text = "正在同步…";
            try { await api.Call("drive.sync"); message.Text = "同步完成。"; message.ForeColor = Color.FromArgb(40, 95, 73); }
            catch (Exception error) { Error(error.Message); RestoreWindow(); }
            finally { busy = false; SetButtons(true); }
            await RefreshStatus();
        }
        async Task OpenManagement() {
            if (api == null) return;
            try {
                Dictionary<string, object> result = (Dictionary<string, object>)await api.Call("app.browser-session", new { settings = true });
                api.OpenBrowser(Convert.ToString(result["url"]));
            } catch (Exception error) { Error(error.Message); RestoreWindow(); }
        }
        public async Task ExitApplication() {
            if (exiting) return;
            exiting = true; timer.Stop(); tray.Visible = false; SetButtons(false);
            try { if (api != null) await api.Call("app.quit"); } catch { }
            if (backend != null) {
                try { if (!await Task.Run(() => backend.WaitForExit(3000))) { backend.Kill(); await Task.Run(() => backend.WaitForExit(3000)); } }
                catch (InvalidOperationException) { }
                backend.Dispose();
            }
            Close();
        }
        protected override void Dispose(bool disposing) {
            if (disposing) { timer.Dispose(); tray.Dispose(); if (backend != null) { try { if (!backend.HasExited) backend.Kill(); } catch (InvalidOperationException) { } } }
            base.Dispose(disposing);
        }
    }

}
