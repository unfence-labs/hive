import { getServerUrl } from "@/hooks/useServerUrl";

/**
 * Build a WebSocket URL against the configured backend, factoring the
 * server-URL resolution and auth-token wiring shared by every PTY-style
 * endpoint (e.g. `/ws/script`, `/ws/terminal`).
 *
 * `path` is the WS path beginning with a slash (e.g. `/ws/terminal/ws-1`).
 * `params` are appended as query string; the auth token (when configured) is
 * added automatically as `token`.
 */
export function buildWsUrl(path: string, params?: Record<string, string>): string {
  const serverUrl = getServerUrl();
  let wsHost: string;
  if (serverUrl) {
    wsHost = serverUrl.replace(/^http/, "ws");
  } else {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    wsHost = import.meta.env.VITE_WS_URL || `${protocol}//${window.location.host}`;
  }
  const authToken = (import.meta.env.VITE_HIVE_AUTH_TOKEN as string | undefined)?.trim();
  const search = new URLSearchParams(params ?? {});
  if (authToken) search.set("token", authToken);
  const query = search.toString();
  return query ? `${wsHost}${path}?${query}` : `${wsHost}${path}`;
}
