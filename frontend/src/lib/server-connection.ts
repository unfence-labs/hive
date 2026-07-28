import type { ServerConnection } from "@/hooks/useConnection";
import { replaceConnection, serverUrlFor } from "@/hooks/useConnection";
import { queryClient } from "@/lib/query-client";
import { wsTransport } from "@/lib/ws-transport";

/**
 * Why a connection attempt failed. "unreachable" and "unauthorized" are kept
 * apart on purpose: a wrong address and a rejected token need different fixes,
 * and one error string for both sends operators hunting the wrong problem.
 */
export type ServerConnectionFailure = "invalid" | "unreachable" | "unauthorized" | "forbidden";

/**
 * The port an installed Hive backend listens on: the production port from
 * `backend/ecosystem.config.cjs`, which `scripts/provision/main.sh` also
 * defaults to. 3000 is the development port and never appears in the UI.
 */
export const DEFAULT_BACKEND_PORT = 9420;

export class ServerConnectionError extends Error {
  constructor(
    public readonly reason: ServerConnectionFailure,
    message: string,
  ) {
    super(message);
    this.name = "ServerConnectionError";
  }
}

/**
 * Accept values that are usable as a URL host, and that an SSH command line
 * could not read as an option rather than a host.
 */
export function normalizeHost(host: string): string {
  const trimmed = host.trim();
  return trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
}

export function isValidHost(host: string): boolean {
  const normalized = normalizeHost(host);
  return /^[A-Za-z0-9.:-]+$/.test(normalized) && !normalized.startsWith("-");
}

export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

export function isValidUserName(user: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9._-]*$/.test(user);
}

export function validateServerConnection(connection: ServerConnection): void {
  if (!isValidHost(connection.host)) {
    throw new ServerConnectionError("invalid", "Enter a valid hostname or IP address.");
  }
  if (!isValidPort(connection.port)) {
    throw new ServerConnectionError("invalid", "Port must be between 1 and 65535.");
  }
  for (const user of [connection.sshUser, connection.adminUser]) {
    if (user && !isValidUserName(user)) {
      throw new ServerConnectionError("invalid", "Enter a valid user name.");
    }
  }
}

/**
 * Check the proposed server answers and accepts the proposed token, before it
 * replaces the stored one. `/api/projects` is used rather than `/health`
 * because health is deliberately unauthenticated and would accept any token.
 */
export async function probeServerConnection(connection: ServerConnection): Promise<void> {
  validateServerConnection(connection);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const headers: Record<string, string> = {};
    if (connection.authToken) headers.Authorization = `Bearer ${connection.authToken}`;
    const response = await fetch(`${serverUrlFor(connection)}/api/projects`, {
      headers,
      signal: controller.signal,
    });
    if (response.status === 401) {
      throw new ServerConnectionError("unauthorized", "The server rejected the access token.");
    }
    if (response.status === 403) {
      throw new ServerConnectionError("forbidden", "The server refused this client.");
    }
    if (!response.ok) {
      throw new ServerConnectionError("unreachable", `The server returned HTTP ${response.status}.`);
    }
  } catch (error) {
    if (error instanceof ServerConnectionError) throw error;
    throw new ServerConnectionError("unreachable", "The server could not be reached.");
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Point the client at a server. With `verify`, nothing is stored unless the
 * probe succeeds, so a failed attempt leaves the working connection intact.
 */
export async function switchServer(
  connection: ServerConnection | null,
  options: { verify?: boolean } = {},
): Promise<void> {
  if (connection) {
    validateServerConnection(connection);
    if (options.verify) await probeServerConnection(connection);
  }

  replaceConnection(connection);
  wsTransport.disconnectAll();
  // Not clear(): mounted observers (e.g. the health badge) are not refetched
  // after a cache teardown and would freeze on their pending state.
  await queryClient.resetQueries();
}
