import { getServerUrl } from "@/hooks/useServerUrl";

export type BrowserStreamConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

export interface BrowserStreamFrame {
  src: string;
  url?: string;
  title?: string;
}

export interface BrowserStreamMetadata {
  url?: string;
  title?: string;
  error?: string;
}

export function buildBrowserStreamUrl(streamPath: string): string {
  const serverUrl = getServerUrl();
  let wsHost: string;
  if (serverUrl) {
    wsHost = serverUrl.replace(/^http/, "ws");
  } else {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    wsHost = import.meta.env.VITE_WS_URL || `${protocol}//${window.location.host}`;
  }
  const authToken = import.meta.env.VITE_HIVE_AUTH_TOKEN?.trim();
  const query = authToken ? `?token=${encodeURIComponent(authToken)}` : "";
  return `${wsHost}${streamPath}${query}`;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function toImageSrc(data: string): string {
  return data.startsWith("data:") ? data : `data:image/jpeg;base64,${data}`;
}

function activeTabMetadata(tabs: unknown): BrowserStreamMetadata {
  if (!Array.isArray(tabs)) return {};
  const tabObjects = tabs.map(asObject).filter((tab): tab is Record<string, unknown> => tab !== null);
  const active = tabObjects.find((tab) => tab.active === true || tab.selected === true) ?? tabObjects[0];
  if (!active) return {};
  return {
    url: asString(active.url),
    title: asString(active.title),
  };
}

export function parseBrowserStreamMessage(raw: string): BrowserStreamFrame | BrowserStreamMetadata | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  const msg = asObject(parsed);
  if (!msg) return null;

  if (msg.type === "frame") {
    const data = asString(msg.data);
    if (!data) return null;
    const metadata = asObject(msg.metadata);
    return {
      src: toImageSrc(data),
      url: asString(msg.url) ?? asString(metadata?.url),
      title: asString(msg.title) ?? asString(metadata?.title),
    };
  }

  if (msg.type === "url") {
    return {
      url: asString(msg.url) ?? asString(msg.value),
      title: asString(msg.title),
    };
  }

  if (msg.type === "tabs") {
    return activeTabMetadata(msg.tabs);
  }

  if (msg.type === "error") {
    return { error: asString(msg.message) ?? "Browser stream error" };
  }

  const tab = asObject(msg.tab);
  if (tab) {
    return {
      url: asString(tab.url),
      title: asString(tab.title),
    };
  }

  return null;
}
