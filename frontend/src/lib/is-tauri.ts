/** True when running inside the Tauri desktop shell (not the web build). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
