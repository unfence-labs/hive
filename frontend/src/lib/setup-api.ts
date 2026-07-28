import { request, type RequestTarget } from "@/hooks/useApi";
import type {
  SetupStatusResponse,
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

export interface SetupApi {
  getTools: (signal?: AbortSignal) => Promise<ToolsResponse>;
  /** Cheap in-memory progress read, safe to poll while work is live. */
  getStatus: (signal?: AbortSignal) => Promise<SetupStatusResponse>;
  startOperation: (
    tool: SetupToolId,
    kind: ToolOperationKind,
  ) => Promise<StartToolOperationResponse>;
  /**
   * Begin a sign-in, replacing whatever sign-in the tool has. Safe over a
   * working credential: the flows back it up and restore it when the new
   * sign-in ends any way but connected.
   */
  startAuth: (tool: SetupToolId) => Promise<ToolAuthSession>;
  submitAuthCode: (tool: SetupToolId, code: string) => Promise<ToolAuthSession>;
  cancelAuth: (tool: SetupToolId) => Promise<ToolAuthSession>;
}

/** Detection spawns several probes server-side; give it room. */
const REQUEST_TIMEOUT_MS = 30_000;

export function createSetupApi(target: SetupApiTarget = {}): SetupApi {
  // An explicit target with no token of its own sends none at all (`""`),
  // rather than inheriting the stored token that belongs to another server.
  const requestTarget: RequestTarget = {
    ...target,
    ...(target.baseUrl && target.authToken === undefined ? { authToken: "" } : {}),
    timeoutMs: REQUEST_TIMEOUT_MS,
  };

  const get = <T>(path: string, signal?: AbortSignal): Promise<T> =>
    request<T>(path, { signal }, requestTarget);
  const post = <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(
      path,
      { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
      requestTarget,
    );

  return {
    getTools: (signal) => get<ToolsResponse>("/api/setup/tools", signal),
    getStatus: (signal) => get<SetupStatusResponse>("/api/setup/status", signal),
    startOperation: (tool, kind) =>
      post<StartToolOperationResponse>(`/api/setup/tools/${tool}/${kind}`),
    startAuth: (tool) => post<ToolAuthSession>(`/api/setup/auth/${tool}/start`),
    submitAuthCode: (tool, code) =>
      post<ToolAuthSession>(`/api/setup/auth/${tool}/code`, { code }),
    cancelAuth: (tool) => post<ToolAuthSession>(`/api/setup/auth/${tool}/cancel`),
  };
}
