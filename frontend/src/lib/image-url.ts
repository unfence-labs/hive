import { getServerUrl } from "@/hooks/useServerUrl";
import { getAuthToken } from "@/hooks/useAuthToken";

/** Resolve an API-backed media path to a browser-loadable src. */
export function resolveApiResourceSrc(dataUrl: string): string {
  if (!dataUrl || dataUrl.startsWith("data:")) return dataUrl;
  const base = getServerUrl();
  const token = getAuthToken();
  const hashIndex = dataUrl.indexOf("#");
  const path = hashIndex >= 0 ? dataUrl.slice(0, hashIndex) : dataUrl;
  const hash = hashIndex >= 0 ? dataUrl.slice(hashIndex) : "";
  const sep = path.includes("?") ? "&" : "?";
  return `${base}${path}${token ? `${sep}token=${encodeURIComponent(token)}` : ""}${hash}`;
}

/** Resolve an image dataUrl to a renderable src. */
export function resolveImageSrc(dataUrl: string): string {
  return resolveApiResourceSrc(dataUrl);
}
