import type { ServerConnection } from "@/hooks/useConnection";
import { replaceConnection, serverUrlFor } from "@/hooks/useConnection";
import { queryClient } from "@/lib/query-client";
import { wsTransport } from "@/lib/ws-transport";

export type ServerConnectionFailure = "unauthorized" | "forbidden" | "unreachable" | "invalid";

export class ServerConnectionError extends Error {
  constructor(
    public readonly reason: ServerConnectionFailure,
    message: string,
  ) {
    super(message);
    this.name = "ServerConnectionError";
  }
}

export function validateServerConnection(connection: ServerConnection): void {
  if (!/^[A-Za-z0-9.:-]+$/.test(connection.host) || connection.host.startsWith("-")) {
    throw new ServerConnectionError("invalid", "Enter a valid hostname or IP address.");
  }
  if (!Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65_535) {
    throw new ServerConnectionError("invalid", "Port must be between 1 and 65535.");
  }
  if (connection.sshUser && !/^[A-Za-z_][A-Za-z0-9._-]*$/.test(connection.sshUser)) {
    throw new ServerConnectionError("invalid", "Enter a valid SSH user.");
  }
}

export async function probeServerConnection(connection: ServerConnection): Promise<void> {
  validateServerConnection(connection);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
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
      throw new ServerConnectionError("forbidden", "This client is not allowed to access the server.");
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
  queryClient.clear();
}
