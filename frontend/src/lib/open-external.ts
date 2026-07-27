import { toast } from "sonner";
import { isDesktopShell } from "@/lib/is-desktop";

/**
 * Open a URL in the system browser.
 * Uses the Tauri opener plugin when running as a desktop app,
 * falls back to window.open for browser mode.
 *
 * The desktop path invokes `plugin:opener|open_url` through
 * `@tauri-apps/api/core` rather than the plugin's JS wrapper: the wrapper is
 * nothing but that invoke call, and its dep chunk has been seen failing to
 * load in WKWebView ("Importing a module script failed") while the core
 * module — which the SSH wizard already runs on — loads fine. The import
 * stays dynamic so a load failure cannot take the route tree down with it;
 * it surfaces as a toast carrying the URL instead, because the window.open
 * fallback is silently dropped inside a Tauri webview.
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
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("plugin:opener|open_url", { url });
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
