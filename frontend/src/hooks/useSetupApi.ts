import { getServerUrl } from "@/hooks/useServerUrl";
import { getAuthToken } from "@/hooks/useAuthToken";
import type {
  SetupStatus,
  SetupOperation,
  RunSetupRequest,
  RunSetupResponse,
} from "@hive/shared/setup-types";

/**
 * Typed client for the setup REST API (§3.4). Progress is polled (§3.5).
 *
 * During the wizard the app-level stores still hold the PREVIOUS server's
 * URL/token (they are only committed on the final screen), so the wizard must
 * bind a client to the NEW server explicitly via {@link createSetupApi}.
 * The default {@link setupApi} export binds to the global stores and serves
 * post-install surfaces (Settings, update banner).
 */

export interface SetupApiTarget {
  /** Base URL, e.g. http://100.x.y.z:3000. Falls back to the stored server URL. */
  baseUrl?: string;
  /** Bearer token. Falls back to the stored runtime token. */
  token?: string;
}

export interface SetupApi {
  getStatus: () => Promise<SetupStatus>;
  run: (body: RunSetupRequest) => Promise<RunSetupResponse>;
  getOperation: (id: string) => Promise<SetupOperation>;
  retryOperation: (id: string) => Promise<RunSetupResponse>;
  /** PRIMARY Claude path: token captured locally by the wizard, POSTed here. */
  submitClaudeToken: (token: string) => Promise<void>;
}

const REQUEST_TIMEOUT_MS = 10_000;

export function createSetupApi(target: SetupApiTarget = {}): SetupApi {
  async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const base = target.baseUrl || getServerUrl();
    const token = target.token || getAuthToken();
    const headers: Record<string, string> = {};
    if (options?.body) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${base}${path}`, {
      ...options,
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${res.status} ${body || res.statusText}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    getStatus: () => request<SetupStatus>("/api/setup/status"),
    run: (body) =>
      request<RunSetupResponse>("/api/setup/run", { method: "POST", body: JSON.stringify(body) }),
    getOperation: (id) => request<SetupOperation>(`/api/setup/operations/${encodeURIComponent(id)}`),
    retryOperation: (id) =>
      request<RunSetupResponse>(`/api/setup/operations/${encodeURIComponent(id)}/retry`, {
        method: "POST",
      }),
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
    const op = await client.getOperation(operationId);
    onUpdate(op);
    if (op.status === "succeeded" || op.status === "failed") return op;
    await new Promise((r) => setTimeout(r, interval));
  }
}
