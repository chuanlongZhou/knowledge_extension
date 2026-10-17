using System;
using System.Diagnostics;
using System.IO;
using System.Text;

namespace PKMNexus {
    // The official runtime is a separate, unchanged file. Application code stays
    // readable on disk; no executable resources, scripts or commands are injected.
    public static class AppRuntime {
        public static string Root { get { return AppDomain.CurrentDomain.BaseDirectory; } }
        public static ProcessStartInfo StartInfo(string root, string mode) {
            string[] allowed = { "--serve", "--sync", "--sync --scheduled" };
            if (Array.IndexOf(allowed, mode) < 0) throw new ArgumentException("Unsupported application mode.");
            string script = Path.Combine(root, "app", "companion", "main.mjs");
            string runtime = Path.Combine(root, "runtime", "node.exe");
            if (!File.Exists(script) || !File.Exists(runtime)) throw new FileNotFoundException("请解压完整应用包，保留 runtime 和 app 文件夹。");
            ProcessStartInfo start = new ProcessStartInfo(runtime, Quote(script) + " " + mode) {
                UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
                WorkingDirectory = root
            };
            start.EnvironmentVariables["PKM_NEXUS_APP_DIR"] = Path.GetFullPath(root);
            // Never inherit Node preload hooks from a developer terminal.
            start.EnvironmentVariables.Remove("NODE_OPTIONS");
            start.EnvironmentVariables.Remove("NODE_PATH");
            return start;
        }
        public static string Quote(string value) {
            if (value.IndexOf('"') >= 0 || value.IndexOf('\r') >= 0 || value.IndexOf('\n') >= 0)
                throw new ArgumentException("Invalid argument.");
            return "\"" + value + "\"";
        }
    }
}
