/**
 * Open a URL in the system browser.
 * Uses the Tauri opener plugin when running as a desktop app,
 * falls back to window.open for browser mode.
 */
export async function openExternal(url: string): Promise<void> {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
