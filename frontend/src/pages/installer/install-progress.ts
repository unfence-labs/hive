import type { ProvisionRecord } from "@/lib/provision-client";

/**
 * Folding the install's NDJSON stream into something renderable. Pure, so the
 * whole progress model is testable without a server, a sidecar or a screen.
 *
 * The record shapes are `scripts/provision/lib.sh`'s: `run_start`, `run_end`,
 * and one `step` record per start / log / ok / skip / error. Anything else the
 * sidecar forwards is not part of this view and is ignored rather than
 * guessed at.
 */

export type InstallStepStatus = "pending" | "running" | "done" | "skipped" | "failed";

export interface InstallStep {
  id: string;
  title: string;
  status: InstallStepStatus;
}

export interface InstallFailure {
  code: string;
  detail: string;
  step?: string;
}

export interface InstallProgress {
  /** "starting" is before the script has said anything at all. */
  status: "starting" | "running" | "succeeded" | "failed";
  /** The script reported it is continuing an earlier run rather than beginning one. */
  resumed: boolean;
  steps: InstallStep[];
  /** The streamed output's text, one line per entry. */
  logs: string[];
  /**
   * The token the run generated, off the `generate_token` step. It lives in
   * memory until it is written to the connection record, and is never part of
   * the installer's own persisted state.
   */
  accessToken?: string;
  /**
   * The service account the backend runs as, off the `create_user` step. A
   * resumed run skips that step but still reports it, so a successful run always
   * names the account rather than leaving it to be guessed.
   */
  serviceUser?: string;
  failure?: InstallFailure;
}

/**
 * How much streamed output is kept. An install runs apt, npm and a download,
 * so the stream is unbounded in principle; the tail is what diagnoses a
 * failure. Nothing here is ever persisted.
 */
export const INSTALL_LOG_LIMIT = 500;

export function initialProgress(): InstallProgress {
  return { status: "starting", resumed: false, steps: [], logs: [] };
}

/** `probe_os` -> `Probe os`, for a step the script has not titled yet. */
function humanize(id: string): string {
  const words = id.replace(/[_-]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function upsert(
  steps: InstallStep[],
  id: string,
  patch: Partial<InstallStep>,
): InstallStep[] {
  const index = steps.findIndex((step) => step.id === id);
  if (index === -1) {
    return [...steps, { id, title: humanize(id), status: "pending", ...patch }];
  }
  const next = steps.slice();
  next[index] = { ...next[index], ...patch };
  return next;
}

function stringData(record: ProvisionRecord, key: string): string | undefined {
  const value = record.data?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function applyStep(state: InstallProgress, record: ProvisionRecord): InstallProgress {
  const step = record.step as string;
  switch (record.status) {
    case "start":
      return {
        ...state,
        status: "running",
        steps: upsert(state.steps, step, {
          status: "running",
          ...(record.title ? { title: record.title } : {}),
        }),
      };
    case "log":
      return {
        ...state,
        logs: [...state.logs, record.line ?? ""].slice(-INSTALL_LOG_LIMIT),
      };
    case "ok":
    case "skip":
      return {
        ...state,
        steps: upsert(state.steps, step, { status: record.status === "ok" ? "done" : "skipped" }),
        ...(stringData(record, "accessToken")
          ? { accessToken: stringData(record, "accessToken") }
          : {}),
        ...(step === "create_user" && stringData(record, "user")
          ? { serviceUser: stringData(record, "user") }
          : {}),
      };
    case "error":
      return {
        ...state,
        steps: upsert(state.steps, step, { status: "failed" }),
        // The first failure wins, here and below: a step's own error names the
        // thing that broke; the `run_end` that follows it repeats the code with
        // less context, and a sidecar-synthesized terminal record has none.
        failure: state.failure ?? {
          code: record.errorCode ?? "UNKNOWN",
          detail: record.detail ?? "the step failed without a diagnostic",
          step,
        },
      };
    default:
      return state;
  }
}

/** Fold one streamed record into the progress view. */
export function applyInstallRecord(
  state: InstallProgress,
  record: ProvisionRecord,
): InstallProgress {
  if (record.event === "run_start") {
    // Seed the plan so the checklist shows every step from the first frame,
    // including the ones a resume will skip.
    return {
      ...state,
      status: "running",
      resumed: record.resume === true,
      steps: (record.stepsPlanned ?? []).map((id) => ({
        id,
        title: humanize(id),
        status: "pending" as const,
      })),
    };
  }
  if (record.event === "run_end") {
    if (record.status !== "ok") {
      return {
        ...state,
        status: "failed",
        failure: state.failure ?? {
          code: record.errorCode ?? "UNKNOWN",
          detail: record.detail ?? "the install ended without a diagnostic",
        },
      };
    }
    // A run that finished without reporting a token would land the app on a
    // server it cannot authenticate against, which is a failure however the
    // script scored it.
    if (!state.accessToken) {
      return {
        ...state,
        status: "failed",
        failure: state.failure ?? {
          code: "UNKNOWN",
          detail: "the install finished but reported no access token",
        },
      };
    }
    // Likewise for the service account. Guessing it would store a connection
    // whose editor and terminal sessions log in as an account that may not
    // exist, and nothing about the failure would point back here.
    if (!state.serviceUser) {
      return {
        ...state,
        status: "failed",
        failure: state.failure ?? {
          code: "UNKNOWN",
          detail: "the install finished but reported no service account",
        },
      };
    }
    return { ...state, status: "succeeded" };
  }
  if (record.event !== undefined || typeof record.step !== "string") return state;
  return applyStep(state, record);
}
