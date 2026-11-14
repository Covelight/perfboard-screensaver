// Single-file support for the .NET Framework build (net48). No-op on .NET 8.
//
// A .NET 8 apphost loads its siblings from its own folder; a .NET Framework .scr
// has no apphost and no deps.json, so an assembly sitting next to the .scr is only
// found because the exe directory happens to be probed — and it isn't, once the
// file is moved around or the runtime decides otherwise. To make one file that is
// genuinely self-contained the three non-framework dependencies are embedded:
//
//   Microsoft.Web.WebView2.Core.dll     managed   -> served by AssemblyResolve
//   Microsoft.Web.WebView2.WinForms.dll managed   -> served by AssemblyResolve
//   WebView2Loader.dll                  native    -> written to %LOCALAPPDATA% and
//                                                    pre-loaded, so Core.dll's own
//                                                    LoadLibrary("WebView2Loader.dll")
//                                                    finds the module already mapped
//
// Nothing here touches the network: no downloads, no update checks.

using System;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;

namespace PerfboardSaver
{
    internal static class Bootstrap
    {
#if NETFRAMEWORK
        private static bool _done;

        [DllImport("kernel32", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr LoadLibraryW(string path);

        [DllImport("kernel32", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool SetDllDirectoryW(string path);

        /// <summary>Call first thing in Main, before any WebView2 type is touched.</summary>
        public static void Install()
        {
            if (_done) return;
            _done = true;
            AppDomain.CurrentDomain.AssemblyResolve += OnResolve;
            NativeLoader.Install();
        }

        private static Assembly OnResolve(object sender, ResolveEventArgs e)
        {
            try
            {
                string simple = new AssemblyName(e.Name).Name;
                using (Stream s = typeof(Bootstrap).Assembly.GetManifestResourceStream(simple + ".dll"))
                {
                    if (s == null) return null;
                    byte[] bytes = new byte[s.Length];
                    int n = 0, r;
                    while (n < bytes.Length && (r = s.Read(bytes, n, bytes.Length - n)) > 0) n += r;
                    return Assembly.Load(bytes);
                }
            }
            catch { return null; }
        }

        private static class NativeLoader
        {
            internal static void Install()
            {
                try
                {
                    string dir = Path.Combine(Config.Dir, "native");
                    Directory.CreateDirectory(dir);
                    string path = Path.Combine(dir, "WebView2Loader.dll");   // name matters: it is matched by base name

                    using (Stream s = typeof(Bootstrap).Assembly.GetManifestResourceStream("WebView2Loader.dll"))
                    {
                        if (s == null) return;
                        bool stale = !File.Exists(path) || new FileInfo(path).Length != s.Length;
                        if (stale)
                        {
                            using (FileStream o = File.Create(path)) { s.CopyTo(o); }
                        }
                    }
                    // Load by full path first, then leave the folder on the DLL
                    // search path so Core.dll's own LoadLibrary("WebView2Loader.dll")
                    // resolves to this module.
                    SetDllDirectoryW(dir);
                    LoadLibraryW(path);
                }
                catch { /* if this fails, Core.dll will report it on its own */ }
            }
        }
#else
        public static void Install() { }
#endif
    }
}
