import type { ProvisionEvent } from "@/lib/provision-client";
import type { SetupErrorCode } from "@hive/shared/setup-errors";

export type ProvisionStepStatus = "pending" | "running" | "succeeded" | "skipped" | "failed";

export interface ProvisionStepView {
  id: string;
  title: string;
  status: ProvisionStepStatus;
  lastLine?: string;
}

export interface ProvisionProgress {
  steps: ProvisionStepView[];
  status: "running" | "succeeded" | "failed";
  error?: { code: SetupErrorCode; step: string; detail?: string };
  /**
   * Tailnet IP reported by the tailscale_up step (fresh run or resume skip).
   * The wizard switches to it after provisioning: with UFW in tailnet mode the
   * backend is only reachable over the tailnet.
   */
  tailnetIp?: string;
}

export function initialProgress(): ProvisionProgress {
  return { steps: [], status: "running" };
}

function humanize(step: string): string {
  return step.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function upsert(
  steps: ProvisionStepView[],
  id: string,
  patch: Partial<ProvisionStepView>,
  fallbackTitle?: string,
): ProvisionStepView[] {
  const idx = steps.findIndex((s) => s.id === id);
  if (idx === -1) {
    return [
      ...steps,
      {
        id,
        title: fallbackTitle ?? humanize(id),
        status: "pending",
        ...patch,
      },
    ];
  }
  const next = steps.slice();
  next[idx] = { ...next[idx], ...patch };
  return next;
}

function tailnetIpFrom(
  event: { step: string; data?: Record<string, unknown> },
  current: string | undefined,
): string | undefined {
  if (event.step !== "tailscale_up") return current;
  const ip = event.data?.tailnetIp;
  return typeof ip === "string" && ip.length > 0 ? ip : current;
}

/** Fold one ProvisionEvent into the progress view (pure). */
export function applyProvisionEvent(
  state: ProvisionProgress,
  event: ProvisionEvent,
): ProvisionProgress {
  switch (event.kind) {
    case "run_start": {
      // Seed the planned steps as pending so the checklist shows the full plan.
      const steps = event.stepsPlanned.map<ProvisionStepView>((id) => ({
        id,
        title: humanize(id),
        status: "pending",
      }));
      // Preserve any already-known statuses (e.g. on resume merge).
      const merged = steps.map((s) => {
        const prev = state.steps.find((p) => p.id === s.id);
        return prev ? { ...s, status: prev.status, lastLine: prev.lastLine } : s;
      });
      return { steps: merged, status: "running", error: undefined };
    }
    case "step_start":
      return {
        ...state,
        steps: upsert(state.steps, event.step, { status: "running", title: event.title }, event.title),
      };
    case "step_log":
      return { ...state, steps: upsert(state.steps, event.step, { lastLine: event.line }) };
    case "step_ok":
      return {
        ...state,
        steps: upsert(state.steps, event.step, { status: "succeeded" }),
        tailnetIp: tailnetIpFrom(event, state.tailnetIp),
      };
    case "step_skip":
      return {
        ...state,
        steps: upsert(state.steps, event.step, { status: "skipped" }),
        tailnetIp: tailnetIpFrom(event, state.tailnetIp),
      };
    case "step_error":
      return {
        ...state,
        steps: upsert(state.steps, event.step, { status: "failed", lastLine: event.detail }),
        status: "failed",
        // Keep the first error: it is the most specific (a later synthetic or
        // stream-level error must not clobber it).
        error: state.error ?? { code: event.errorCode, step: event.step, detail: event.detail },
      };
    case "run_end":
      return {
        ...state,
        status: event.status === "ok" ? "succeeded" : "failed",
        error:
          event.status === "ok"
            ? state.error
            : state.error ??
              (event.errorCode
                ? { code: event.errorCode, step: "provision", detail: event.detail }
                : undefined),
      };
    default:
      return state;
  }
}
