using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using Microsoft.Win32;

namespace PKMNexus {
    static class PlatformEntry {
        const string HostKey = @"Software\Google\Chrome\NativeMessagingHosts\com.pkm_nexus.companion";
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 1024 * 1024 };
        static string Text(Dictionary<string, object> value, string key) {
            object result;
            if (!value.TryGetValue(key, out result) || !(result is string)) throw new ArgumentException("Missing text field.");
            return (string)result;
        }
        static string FullPath(string value) {
            if (!Path.IsPathRooted(value) || value.StartsWith(@"\\") || value.IndexOf('\0') >= 0)
                throw new ArgumentException("A local absolute path is required.");
            return Path.GetFullPath(value);
        }
        static object NativeRegister(Dictionary<string, object> payload) {
            string file = FullPath(Text(payload, "manifest"));
            Dictionary<string, object> manifest = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(file, Encoding.UTF8));
            string expected = Path.Combine(AppRuntime.Root, "PKM-Nexus-NativeHost.exe");
            if (Text(manifest, "name") != "com.pkm_nexus.companion" || Text(manifest, "type") != "stdio" ||
                !String.Equals(FullPath(Text(manifest, "path")), expected, StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("Invalid native host manifest.");
            System.Collections.IEnumerable origins = manifest["allowed_origins"] as System.Collections.IEnumerable;
            int count = 0;
            foreach (object item in origins) {
                if (!(item is string) || !Regex.IsMatch((string)item, "^chrome-extension://[a-p]{32}/$")) throw new ArgumentException("Invalid extension origin.");
                count++;
            }
            if (count == 0 || count > 32) throw new ArgumentException("Invalid origin count.");
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(HostKey)) key.SetValue("", file, RegistryValueKind.String);
            return new { registered = true };
        }
        static object NativeRemove(Dictionary<string, object> payload) {
            string expected = FullPath(Text(payload, "manifest"));
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(HostKey)) {
                if (key == null) return new { removed = false };
                if (!String.Equals(Convert.ToString(key.GetValue("")), expected, StringComparison.OrdinalIgnoreCase))
                    throw new ArgumentException("This registration belongs to another application location.");
            }
            Registry.CurrentUser.DeleteSubKey(HostKey, false);
            return new { removed = true };
        }
        static string TaskName(Dictionary<string, object> payload) {
            string name = Text(payload, "taskName");
            if (name != "PKM Nexus Hourly Sync" && !Regex.IsMatch(name, "^PKM Nexus Validation [a-f0-9-]{36}$"))
                throw new ArgumentException("Unsupported task name.");
            return name;
        }
        static void OwnTask(dynamic task) {
            string owner = Convert.ToString(task.Definition.Principal.UserId);
            SecurityIdentifier ownerSid;
            try { ownerSid = new SecurityIdentifier(owner); }
            catch (ArgumentException) { ownerSid = (SecurityIdentifier)new NTAccount(owner).Translate(typeof(SecurityIdentifier)); }
            string action = Convert.ToString(task.Definition.Actions[1].Path);
            string legacy = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "PKM Nexus", "PKM-Nexus.exe");
            if (!ownerSid.Equals(WindowsIdentity.GetCurrent().User))
                throw new ArgumentException("Task belongs to another user.");
            if (!String.Equals(action, Path.Combine(AppRuntime.Root, "PKM-Nexus.exe"), StringComparison.OrdinalIgnoreCase) && !String.Equals(action, legacy, StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("Task belongs to another application location.");
        }
        static object Schedule(Dictionary<string, object> payload, bool inspect) {
            string name = TaskName(payload), sid = WindowsIdentity.GetCurrent().User.Value;
            dynamic scheduler = Activator.CreateInstance(Type.GetTypeFromProgID("Schedule.Service"));
            scheduler.Connect();
            dynamic folder = scheduler.GetFolder(@"\");
            dynamic existing = null;
            try { existing = folder.GetTask(name); }
            catch (COMException error) { if ((uint)error.ErrorCode != 0x80070002) throw; }
            catch (FileNotFoundException) { }
            if (existing != null) OwnTask(existing);
            if (inspect) {
                if (existing == null) return new { exists = false };
                List<string> intervals = new List<string>();
                foreach (dynamic trigger in existing.Definition.Triggers) intervals.Add(Convert.ToString(trigger.Repetition.Interval));
                return new { exists = true, execute = Convert.ToString(existing.Definition.Actions[1].Path), arguments = Convert.ToString(existing.Definition.Actions[1].Arguments), triggers = (int)existing.Definition.Triggers.Count, intervals, catchUp = (bool)existing.Definition.Settings.StartWhenAvailable, runLevel = (int)existing.Definition.Principal.RunLevel == 0 ? "Limited" : "Highest", userId = Convert.ToString(existing.Definition.Principal.UserId) };
            }
            bool enabled = payload.ContainsKey("enabled") && payload["enabled"] is bool && (bool)payload["enabled"];
            if (!enabled) { if (existing != null) folder.DeleteTask(name, 0); return new { enabled = false }; }
            dynamic definition = scheduler.NewTask(0);
            definition.RegistrationInfo.Description = "PKM Nexus：仅在用户明确开启后，每小时同步自己的资料库。";
            definition.Principal.UserId = sid; definition.Principal.LogonType = 3; definition.Principal.RunLevel = 0;
            definition.Settings.StartWhenAvailable = true; definition.Settings.MultipleInstances = 2;
            definition.Settings.ExecutionTimeLimit = "PT1H"; definition.Settings.DisallowStartIfOnBatteries = false; definition.Settings.StopIfGoingOnBatteries = false;
            dynamic hourly = definition.Triggers.Create(1);
            hourly.StartBoundary = DateTime.Now.AddHours(1).ToString("s"); hourly.Repetition.Interval = "PT1H";
            dynamic login = definition.Triggers.Create(9); login.UserId = sid;
            dynamic action = definition.Actions.Create(0);
            action.Path = Path.Combine(AppRuntime.Root, "PKM-Nexus.exe"); action.Arguments = "--sync --scheduled"; action.WorkingDirectory = AppRuntime.Root;
            folder.RegisterTaskDefinition(name, definition, 6, sid, null, 3, null);
            return new { enabled = true };
        }
        static object Handle(string command, Dictionary<string, object> payload) {
            switch (command) {
                case "protect": {
                    byte[] bytes = Encoding.UTF8.GetBytes(Text(payload, "text"));
                    return new { data = Convert.ToBase64String(ProtectedData.Protect(bytes, null, DataProtectionScope.CurrentUser)) };
                }
                case "unprotect": {
                    byte[] bytes = Convert.FromBase64String(Text(payload, "data"));
                    return new { text = Encoding.UTF8.GetString(ProtectedData.Unprotect(bytes, null, DataProtectionScope.CurrentUser)) };
                }
                case "native.register": return NativeRegister(payload);
                case "native.remove": return NativeRemove(payload);
                case "schedule.set": return Schedule(payload, false);
                case "schedule.get": return Schedule(payload, true);
                case "browser.open": {
                    Uri uri = new Uri(Text(payload, "url"));
                    if (!(uri.Scheme == "https" && uri.Host == "accounts.google.com") && !(uri.Scheme == "http" && uri.Host == "127.0.0.1")) throw new ArgumentException("Unsupported browser URL.");
                    Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
                    return new { opened = true };
                }
                case "ui.open": {
                    Process.Start(new ProcessStartInfo(Path.Combine(AppRuntime.Root, "PKM-Nexus.exe"), "--open") { UseShellExecute = false, CreateNoWindow = true });
                    return new { opened = true };
                }
                default: throw new ArgumentException("Unsupported Windows operation.");
            }
        }
        static int Main() {
            try {
                byte[] buffer = new byte[8192];
                using (MemoryStream bytes = new MemoryStream()) {
                    Stream input = Console.OpenStandardInput(); int read;
                    while ((read = input.Read(buffer, 0, buffer.Length)) > 0) {
                        if (bytes.Length + read > 1024 * 1024) throw new ArgumentException("Request exceeds limit.");
                        bytes.Write(buffer, 0, read);
                    }
                    Dictionary<string, object> request = Json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(bytes.ToArray()));
                    Dictionary<string, object> payload = request["payload"] as Dictionary<string, object>;
                    if (payload == null) throw new ArgumentException("Missing operation payload.");
                    object result = Handle(Text(request, "command"), payload);
                    WriteResponse(new { ok = true, result });
                }
                return 0;
            } catch (Exception error) {
                // Payloads may contain credentials. Never print input or a stack trace.
                WriteResponse(new { ok = false, error = "Windows 操作失败，请检查配置与当前用户权限。", errorType = error.GetType().Name, code = error.HResult.ToString("X8") });
                return 1;
            }
        }
        static void WriteResponse(object value) {
            // GUI processes have redirected pipes but no console code page.
            using (StreamWriter output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false))) {
                output.Write(Json.Serialize(value)); output.Flush();
            }
        }
    }
}
