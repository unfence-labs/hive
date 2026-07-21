import { getServerUrl } from "@/hooks/useServerUrl";
import { getAuthToken } from "@/hooks/useAuthToken";
import type {
  SetupStatus,
  SetupOperation,
  RunSetupRequest,
  RunSetupResponse,
} from "@hive/shared/setup-types";
import type { SetupErrorCode } from "@hive/shared/setup-errors";

/**
 * Typed client for the setup REST API. Progress is polled.
 *
 * During the wizard the app-level stores still hold the PREVIOUS server's URL
 * (they are only committed on the final screen), so the wizard must bind a
 * client to the NEW server explicitly via {@link createSetupApi}. The default
 * {@link setupApi} export binds to the global stores and serves post-install
 * surfaces (Settings).
 */

export interface SetupApiTarget {
  /** Base URL, e.g. http://100.x.y.z:3000. Falls back to the stored server URL. */
  baseUrl?: string;
  /** Bearer token for this target. Explicit targets never inherit the stored server token. */
  authToken?: string;
}

/** Non-2xx response; `code` carries the backend's typed error code when present. */
export class SetupApiError extends Error {
  readonly code?: SetupErrorCode;
  readonly status?: number;
  constructor(message: string, code?: SetupErrorCode, status?: number) {
    super(message);
    this.name = "SetupApiError";
    this.code = code;
    this.status = status;
  }
}

export interface SetupApi {
  getStatus: () => Promise<SetupStatus>;
  run: (body: RunSetupRequest) => Promise<RunSetupResponse>;
  getOperation: (id: string, signal?: AbortSignal) => Promise<SetupOperation>;
  /** PRIMARY Claude path: token captured locally by the wizard, POSTed here. */
  submitClaudeToken: (token: string) => Promise<void>;
}

const REQUEST_TIMEOUT_MS = 10_000;

export function createSetupApi(target: SetupApiTarget = {}): SetupApi {
  async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const base = target.baseUrl || getServerUrl();
    const token = target.authToken ?? (target.baseUrl ? "" : getAuthToken());
    const headers: Record<string, string> = {};
    if (options?.body) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const res = await fetch(`${base}${path}`, {
      ...options,
      headers,
      signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let code: SetupErrorCode | undefined;
      try {
        code = (JSON.parse(body) as { code?: SetupErrorCode }).code;
      } catch {
        // non-JSON error body
      }
      throw new SetupApiError(`${res.status} ${body || res.statusText}`, code, res.status);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    getStatus: () => request<SetupStatus>("/api/setup/status"),
    run: (body) =>
      request<RunSetupResponse>("/api/setup/run", { method: "POST", body: JSON.stringify(body) }),
    getOperation: (id, signal) =>
      request<SetupOperation>(`/api/setup/operations/${encodeURIComponent(id)}`, { signal }),
    submitClaudeToken: (token) =>
      request<void>("/api/setup/auth/claude/token", { method: "POST", body: JSON.stringify({ token }) }),
  };
}

/** Client bound to the app's stored connection (post-install surfaces). */
export const setupApi: SetupApi = createSetupApi();

/**
 * Poll an operation to completion. Resolves with the terminal SetupOperation
 * (status "succeeded" or "failed"). `onUpdate` is called on every poll so the
 * UI can render intermediate step/action state.
 */
export async function pollOperation(
  operationId: string,
  onUpdate: (op: SetupOperation) => void,
  options?: { intervalMs?: number; signal?: AbortSignal; api?: SetupApi },
): Promise<SetupOperation> {
  const interval = options?.intervalMs ?? 1500;
  const client = options?.api ?? setupApi;
  for (;;) {
    if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    let op: SetupOperation;
    try {
      op = await client.getOperation(operationId, options?.signal);
    } catch (error) {
      if (error instanceof SetupApiError && error.status === 404) {
        throw new SetupApiError(
          "The setup operation was interrupted. Start it again to resume.",
          "INTERRUPTED",
          404,
        );
      }
      throw error;
    }
    onUpdate(op);
    if (op.status === "succeeded" || op.status === "failed") return op;
    await new Promise((r) => setTimeout(r, interval));
  }
}
