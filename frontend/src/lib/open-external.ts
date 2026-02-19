/**
 * Open a URL in the system browser.
 * Uses the Tauri opener plugin when running as a desktop app,
 * falls back to window.open for browser mode.
 */
export async function openExternal(url: string): Promise<void> {
  const isHttp = /^https?:\/\//i.test(url);
  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  if (!isTauri) {
    // Keep fallback synchronous in browser mode so popup blockers do not drop it.
    if (isHttp) {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      window.location.assign(url);
    }
    return;
  }

  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch (error) {
    console.warn("Failed to open external URL via Tauri opener:", error);
    if (isHttp) {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      window.location.assign(url);
    }
  }
}

/**
 * Build a VS Code Remote SSH URI for a given host and remote path.
 * Format: vscode://vscode-remote/ssh-remote+{host}{path}
 */
export function buildVscodeRemoteUri(host: string, remotePath: string): string {
  const normalizedHost = host.trim();
  const normalizedPath = remotePath.trim().replace(/\\/g, "/");
  const encodedHost = encodeURIComponent(normalizedHost);
  const pathWithLeadingSlash = normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`;
  const encodedPath = pathWithLeadingSlash
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `vscode://vscode-remote/ssh-remote+${encodedHost}${encodedPath}`;
}
