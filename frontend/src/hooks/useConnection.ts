import { useCallback, useSyncExternalStore } from "react";
import { isValidPort, normalizeHost } from "@/lib/server-connection";

/**
 * The one server this client talks to. Stored as a single record so address,
 * protocol, credentials and user accounts can never drift apart.
 *
 * The two user fields are deliberately separate accounts and must not be
 * conflated: `sshUser` is the unprivileged service account the backend runs as
 * and which owns the repositories, so editor and terminal sessions must connect
 * as that account — connecting as `adminUser` (typically root) silently
 * rewrites file ownership on every save and locks the agent out of its own
 * worktrees. `adminUser` is only the login used to run the install.
 */
export interface ServerConnection {
  host: string;
  port: number;
  protocol?: "http" | "https";
  /** Runtime access token presented to the backend on every call. */
  authToken?: string;
  /** Unprivileged service account used for editor and terminal sessions. */
  sshUser?: string;
  /** Admin account used to log in over SSH and run the install. */
  adminUser?: string;
}

export const CONNECTION_STORAGE_KEY = "hive-connection";

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Validate a candidate record. Anything malformed or partial — a bad JSON blob,
 * a missing host, a non-numeric or out-of-range port — resolves to `null`, i.e.
 * "no server configured", rather than a half-usable connection.
 */
function normalizeConnection(value: unknown): ServerConnection | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ServerConnection>;
  const host = normalizeHost(trimmedString(candidate.host));
  const { port } = candidate;
  if (!host) return null;
  if (typeof port !== "number" || !isValidPort(port)) return null;

  const authToken = trimmedString(candidate.authToken);
  const sshUser = trimmedString(candidate.sshUser);
  const adminUser = trimmedString(candidate.adminUser);
  return {
    host,
    port,
    ...(candidate.protocol === "https" ? { protocol: "https" as const } : {}),
    ...(authToken ? { authToken } : {}),
    ...(sshUser ? { sshUser } : {}),
    ...(adminUser ? { adminUser } : {}),
  };
}

function parseStored(raw: string): ServerConnection | null {
  if (!raw) return null;
  try {
    return normalizeConnection(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Parse-once cache, keyed by the raw stored string. The URL and token are read
 * on every HTTP request, every image URL and every subscriber render, so the
 * JSON parse must only run when the stored record actually changes. Keying by
 * the raw string makes invalidation automatic: any write — through `notify()`
 * or another tab's storage event — misses the cache on the next read.
 */
let cached: { raw: string; connection: ServerConnection | null; url: string } = {
  raw: "",
  connection: null,
  url: "",
};

function readStore(): typeof cached {
  const raw = localStorage.getItem(CONNECTION_STORAGE_KEY) ?? "";
  if (cached.raw !== raw) {
    const connection = parseStored(raw);
    cached = { raw, connection, url: serverUrlFor(connection) };
  }
  return cached;
}

/** Raw store snapshot. Empty string when nothing valid is stored. */
function getSnapshot(): string {
  const store = readStore();
  return store.connection ? store.raw : "";
}

function getServerSnapshot(): string {
  return "";
}

/** Read the connection outside of React. */
export function getConnection(): ServerConnection | null {
  return readStore().connection;
}

/** Write (or clear) the connection as one atomic record. */
export function replaceConnection(connection: ServerConnection | null): void {
  const normalized = normalizeConnection(connection);
  if (normalized) {
    localStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(normalized));
  } else {
    localStorage.removeItem(CONNECTION_STORAGE_KEY);
  }
  notify();
}

/** Bracket-wrap IPv6 literals so they can carry a port in a URL. */
function formatHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

export function serverUrlFor(connection: ServerConnection | null): string {
  if (!connection?.host) return "";
  const protocol = connection.protocol ?? "http";
  const isDefaultPort =
    (protocol === "http" && connection.port === 80) ||
    (protocol === "https" && connection.port === 443);
  return `${protocol}://${formatHost(connection.host)}${isDefaultPort ? "" : `:${connection.port}`}`;
}

/** Read the derived server URL outside of React (for useApi, ws transports). */
export function getServerUrl(): string {
  return readStore().url;
}

/**
 * Read the runtime access token outside of React. The token lives on the stored
 * connection record only — there is no build-time fallback, so changing it never
 * requires a rebuild.
 */
export function getAuthToken(): string {
  return readStore().connection?.authToken ?? "";
}

export function useConnection() {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // Referentially stable per stored record: the cache hands back the same
  // parsed object until the raw string changes.
  const connection = raw ? readStore().connection : null;
  const setConnection = useCallback((next: ServerConnection | null) => replaceConnection(next), []);
  return {
    connection,
    serverUrl: serverUrlFor(connection),
    isConfigured: connection !== null,
    setConnection,
  };
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === CONNECTION_STORAGE_KEY || event.key === null) notify();
  });
}
