/**
 * True inside the Tauri desktop shell, false in the web build.
 *
 * Read at call time rather than at module load: the global is injected by the
 * webview before the bundle runs, but tests set and clear it per case.
 */
export function isDesktopShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
