using System;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace PKMNexus {
    static class NativeEntry {
        static async Task Pipe(Stream input, Stream output) {
            byte[] buffer = new byte[8192]; int read;
            while ((read = await input.ReadAsync(buffer, 0, buffer.Length)) > 0) {
                await output.WriteAsync(buffer, 0, read);
                await output.FlushAsync();
            }
        }
        // Chrome requires an executable host and supplies the extension origin.
        // This fixed bridge only transports its stdio to the readable Node app.
        static int Main(string[] args) {
            string origin = Array.Find(args, arg => Regex.IsMatch(arg, "^chrome-extension://[a-p]{32}/$"));
            if (origin == null) return 1;
            try {
                ProcessStartInfo start = AppRuntime.StartInfo(AppRuntime.Root, "--serve");
                string script = Path.Combine(AppRuntime.Root, "app", "companion", "main.mjs");
                start.Arguments = AppRuntime.Quote(script) + " " + origin;
                using (Process worker = new Process { StartInfo = start }) {
                    worker.Start();
                    Task input = Task.Run(async delegate {
                        try { await Pipe(Console.OpenStandardInput(), worker.StandardInput.BaseStream); }
                        finally { worker.StandardInput.Close(); }
                    });
                    Task output = Pipe(worker.StandardOutput.BaseStream, Console.OpenStandardOutput());
                    // Do not relay diagnostics that could corrupt Chrome's framing.
                    Task<string> error = worker.StandardError.ReadToEndAsync();
                    worker.WaitForExit();
                    output.GetAwaiter().GetResult(); error.GetAwaiter().GetResult();
                    GC.KeepAlive(input);
                    return worker.ExitCode;
                }
            } catch { return 1; }
        }
    }
}
