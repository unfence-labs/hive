import { toast } from "sonner";
import { isDesktopShell } from "@/lib/is-desktop";

/**
 * Open a URL in the system browser.
 * Uses the Tauri opener plugin when running as a desktop app,
 * falls back to window.open for browser mode.
 *
 * The plugin stays a dynamic import so a module that fails to load (stale
 * Vite dep cache, offline chunk) cannot take the whole route tree down with
 * it — but the failure surfaces as a toast carrying the URL, because the
 * window.open fallback is silently dropped inside a Tauri webview.
 */
export async function openExternal(url: string): Promise<void> {
  const isHttp = /^https?:\/\//i.test(url);
  const isTauri = isDesktopShell();

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
    toast.error("Couldn't open the browser", {
      description: `Open this link manually: ${url}`,
      duration: 15_000,
    });
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
