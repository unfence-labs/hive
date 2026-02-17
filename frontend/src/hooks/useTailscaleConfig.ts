import { useCallback, useSyncExternalStore } from "react";

const IP_KEY = "hive-tailscale-ip";
const PORT_KEY = "hive-tailscale-port";
const SERVER_URL_KEY = "hive-server-url";

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getIpSnapshot(): string {
  return localStorage.getItem(IP_KEY) ?? "";
}

function getPortSnapshot(): string {
  return localStorage.getItem(PORT_KEY) ?? "";
}

function getServerSnapshot(): string {
  return "";
}

/** Sync the computed server URL to localStorage so useServerUrl / getServerUrl keep working. */
function syncServerUrl(ip: string, port: string) {
  if (ip && port) {
    localStorage.setItem(SERVER_URL_KEY, `http://${ip}:${port}`);
  } else {
    localStorage.removeItem(SERVER_URL_KEY);
  }
}

/** Read Tailscale config outside of React. */
export function getTailscaleConfig() {
  const ip = localStorage.getItem(IP_KEY) ?? "";
  const port = localStorage.getItem(PORT_KEY) ?? "";
  return { ip, port, isConfigured: ip !== "" && port !== "" };
}

export function useTailscaleConfig() {
  const ip = useSyncExternalStore(subscribe, getIpSnapshot, getServerSnapshot);
  const port = useSyncExternalStore(subscribe, getPortSnapshot, getServerSnapshot);

  const setIp = useCallback((value: string) => {
    const trimmed = value.trim();
    if (trimmed) {
      localStorage.setItem(IP_KEY, trimmed);
    } else {
      localStorage.removeItem(IP_KEY);
    }
    syncServerUrl(trimmed, localStorage.getItem(PORT_KEY) ?? "");
    notify();
  }, []);

  const setPort = useCallback((value: string) => {
    const trimmed = value.trim();
    if (trimmed) {
      localStorage.setItem(PORT_KEY, trimmed);
    } else {
      localStorage.removeItem(PORT_KEY);
    }
    syncServerUrl(localStorage.getItem(IP_KEY) ?? "", trimmed);
    notify();
  }, []);

  return { ip, port, setIp, setPort, isConfigured: ip !== "" && port !== "" };
}
