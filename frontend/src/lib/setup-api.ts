import { getAuthToken, getServerUrl } from "@/hooks/useConnection";
import type {
  AgentAuthToolId,
  SetupToolId,
  StartToolOperationResponse,
  ToolAuthSession,
  ToolOperationKind,
  ToolsResponse,
} from "@hive/shared/setup-types";

/**
 * Typed client for the tool detection / install / update API.
 *
 * It takes an optional explicit target instead of always reading the stored
 * connection, because the same panel is embedded in the installer's final
 * screen, where the stored connection may still point at the previous server.
 * An explicit target never inherits the stored token — a token belongs to one
 * server and sending it to another leaks it.
 */
export interface SetupApiTarget {
  baseUrl?: string;
  authToken?: string;
}

export class SetupApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SetupApiError";
  }
}

export interface SetupApi {
  getTools: (signal?: AbortSignal) => Promise<ToolsResponse>;
  startOperation: (
    tool: SetupToolId,
    kind: ToolOperationKind,
  ) => Promise<StartToolOperationResponse>;
  /**
   * Begin a sign-in. Rejects with a 409 {@link SetupApiError} when starting
   * would sign the server out of a tool that currently works; the message is
   * what to ask the operator before retrying with `force`.
   */
  startAuth: (tool: AgentAuthToolId, opts?: { force?: boolean }) => Promise<ToolAuthSession>;
  submitAuthCode: (tool: AgentAuthToolId, code: string) => Promise<ToolAuthSession>;
  cancelAuth: (tool: AgentAuthToolId) => Promise<ToolAuthSession>;
}

/** The 409 a start request answers with when it needs an explicit yes first. */
export const CONFIRM_REQUIRED_STATUS = 409;

/** Detection spawns several probes server-side; give it room. */
const REQUEST_TIMEOUT_MS = 30_000;

function messageFrom(body: string, fallback: string): string {
  if (!body.trim()) return fallback;
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    for (const value of [parsed.error, parsed.message]) {
      if (typeof value === "string" && value.trim()) return value;
    }
  } catch {
    // Plain-text errors are already display-ready.
  }
  return body;
}

export function createSetupApi(target: SetupApiTarget = {}): SetupApi {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const base = target.baseUrl || getServerUrl();
    const token = target.authToken ?? (target.baseUrl ? "" : getAuthToken());
    // Merged, not replaced: a caller sending a body has to be able to declare
    // its type without losing the credential, and vice versa.
    const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
    if (token) headers.Authorization = `Bearer ${token}`;

    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;

    const res = await fetch(`${base}${path}`, { ...init, headers, signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new SetupApiError(res.status, messageFrom(body, res.statusText));
    }
    return (await res.json()) as T;
  }

  function post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: "POST",
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    });
  }

  return {
    getTools: (signal) => request<ToolsResponse>("/api/setup/tools", { signal }),
    startOperation: (tool, kind) =>
      post<StartToolOperationResponse>(`/api/setup/tools/${tool}/${kind}`),
    startAuth: (tool, opts) =>
      post<ToolAuthSession>(`/api/setup/auth/${tool}/start`, { force: opts?.force === true }),
    submitAuthCode: (tool, code) =>
      post<ToolAuthSession>(`/api/setup/auth/${tool}/code`, { code }),
    cancelAuth: (tool) => post<ToolAuthSession>(`/api/setup/auth/${tool}/cancel`),
  };
}
