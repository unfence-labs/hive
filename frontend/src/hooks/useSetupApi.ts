import { api } from "@/hooks/useApi";
import type {
  SetupStatus,
  SetupOperation,
  RunSetupRequest,
  RunSetupResponse,
} from "@hive/shared/setup-types";

/**
 * Thin typed wrapper over the setup REST API (§3.4). Uses the shared `api`
 * client, which already injects the runtime auth token via getAuthToken() and
 * the configured server URL. Progress is polled (§3.5) — no WS channel.
 */
export const setupApi = {
  getStatus: () => api.get<SetupStatus>("/api/setup/status"),

  run: (body: RunSetupRequest) => api.post<RunSetupResponse>("/api/setup/run", body),

  getOperation: (id: string) =>
    api.get<SetupOperation>(`/api/setup/operations/${encodeURIComponent(id)}`),

  retryOperation: (id: string) =>
    api.post<RunSetupResponse>(`/api/setup/operations/${encodeURIComponent(id)}/retry`),

  /** PRIMARY Claude path: token captured locally by the wizard, POSTed here. */
  submitClaudeToken: (token: string) =>
    api.post<void>("/api/setup/auth/claude/token", { token }),
};

/**
 * Poll an operation to completion. Resolves with the terminal SetupOperation
 * (status "succeeded" or "failed"). `onUpdate` is called on every poll so the
 * UI can render intermediate step/action state.
 */
export async function pollOperation(
  operationId: string,
  onUpdate: (op: SetupOperation) => void,
  options?: { intervalMs?: number; signal?: AbortSignal },
): Promise<SetupOperation> {
  const interval = options?.intervalMs ?? 1500;
  for (;;) {
    if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const op = await setupApi.getOperation(operationId);
    onUpdate(op);
    if (op.status === "succeeded" || op.status === "failed") return op;
    await new Promise((r) => setTimeout(r, interval));
  }
}
