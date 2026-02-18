import { getServerUrl } from "@/hooks/useServerUrl";

/** Resolve an image dataUrl to a renderable src.
 *  - `data:` URIs (legacy base64) are returned as-is.
 *  - `/api/...` paths are prefixed with the server URL + auth token query param. */
export function resolveImageSrc(dataUrl: string): string {
  if (!dataUrl || dataUrl.startsWith("data:")) return dataUrl;
  const base = getServerUrl();
  const token = import.meta.env.VITE_HIVE_AUTH_TOKEN?.trim();
  const sep = dataUrl.includes("?") ? "&" : "?";
  return `${base}${dataUrl}${token ? `${sep}token=${encodeURIComponent(token)}` : ""}`;
}
