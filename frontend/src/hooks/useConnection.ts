import { useCallback, useMemo, useSyncExternalStore } from "react";

export interface ServerConnection {
  host: string;
  port: number;
  sshUser?: string;
  authToken?: string;
  protocol?: "http" | "https";
}

export const CONNECTION_STORAGE_KEY = "hive-connection";

const LEGACY_KEYS = [
  "hive-tailscale-ip",
  "hive-tailscale-port",
  "hive-ssh-user",
  "hive-server-url",
  "hive-auth-token",
  "hive-ssh-connection",
] as const;

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function normalizeConnection(value: unknown): ServerConnection | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ServerConnection>;
  const host = typeof candidate.host === "string" ? candidate.host.trim() : "";
  const port = Number(candidate.port);
  const sshUser = typeof candidate.sshUser === "string" ? candidate.sshUser.trim() : "";
  const authToken = typeof candidate.authToken === "string" ? candidate.authToken.trim() : "";
  if ((!host && !authToken) || !Number.isInteger(port) || port < 1 || port > 65_535) return null;
  const protocol = candidate.protocol === "https" ? "https" : "http";
  return {
    host,
    port,
    ...(sshUser ? { sshUser } : {}),
    ...(authToken ? { authToken } : {}),
    ...(protocol === "https" ? { protocol } : {}),
  };
}

function parseStored(raw: string | null): ServerConnection | null {
  if (!raw) return null;
  try {
    return normalizeConnection(JSON.parse(raw));
  } catch {
    return null;
  }
}

function migrateLegacyConnection(): ServerConnection | null {
  const legacyUrl = localStorage.getItem("hive-server-url")?.trim() ?? "";
  const legacyHost = localStorage.getItem("hive-tailscale-ip")?.trim() ?? "";
  const legacyPort = localStorage.getItem("hive-tailscale-port")?.trim() ?? "";
  let host = legacyHost;
  let port = Number(legacyPort || 3000);
  let protocol: "http" | "https" = "http";

  if (legacyUrl) {
    try {
      const parsed = new URL(legacyUrl.includes("://") ? legacyUrl : `http://${legacyUrl}`);
      host ||= parsed.hostname;
      if (!legacyPort) port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
      protocol = parsed.protocol === "https:" ? "https" : "http";
    } catch {
      // An invalid legacy URL is ignored; the explicit host may still migrate.
    }
  }

  const connection = normalizeConnection({
    host,
    port,
    protocol,
    sshUser: localStorage.getItem("hive-ssh-user") ?? undefined,
    authToken: localStorage.getItem("hive-auth-token") ?? undefined,
  });
  if (!connection) return null;

  localStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(connection));
  for (const key of LEGACY_KEYS) localStorage.removeItem(key);
  return connection;
}

function getSnapshot(): string {
  const stored = localStorage.getItem(CONNECTION_STORAGE_KEY);
  if (parseStored(stored)) return stored as string;
  const migrated = migrateLegacyConnection();
  return migrated ? JSON.stringify(migrated) : "";
}

function getServerSnapshot(): string {
  return "";
}

export function getConnection(): ServerConnection | null {
  return parseStored(getSnapshot());
}

export function replaceConnection(connection: ServerConnection | null): void {
  const normalized = normalizeConnection(connection);
  if (normalized) {
    localStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(normalized));
  } else {
    localStorage.removeItem(CONNECTION_STORAGE_KEY);
  }
  for (const key of LEGACY_KEYS) localStorage.removeItem(key);
  notify();
}

function formatHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

export function serverUrlFor(connection: ServerConnection | null): string {
  if (!connection?.host) return "";
  const protocol = connection.protocol ?? "http";
  const defaultPort = (protocol === "http" && connection.port === 80)
    || (protocol === "https" && connection.port === 443);
  return `${protocol}://${formatHost(connection.host)}${defaultPort ? "" : `:${connection.port}`}`;
}

export function getServerUrl(): string {
  return serverUrlFor(getConnection());
}

export function getAuthToken(): string {
  return getConnection()?.authToken ?? import.meta.env.VITE_HIVE_AUTH_TOKEN?.trim() ?? "";
}

export function useConnection() {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const connection = useMemo(() => parseStored(raw), [raw]);
  const setConnection = useCallback((next: ServerConnection | null) => replaceConnection(next), []);
  return {
    connection,
    serverUrl: serverUrlFor(connection),
    isConfigured: Boolean(connection?.host),
    setConnection,
  };
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === CONNECTION_STORAGE_KEY || event.key === null) notify();
  });
}
