import type { SetupErrorCode } from "@hive/shared/setup-errors";

/**
 * Wizard state machine. Pure and fully testable; the React shell
 * (SetupWizard.tsx) owns rendering and side effects. States are linear with a
 * `back` affordance and a global error panel.
 */

export const SETUP_STATES = [
  "welcome",
  "tailscale",
  "ssh_key",
  "server",
  "host_trust",
  "provisioning",
  "tailnet_handoff",
  "guided_setup",
  "done",
] as const;

export type SetupState = (typeof SETUP_STATES)[number];

/** Inputs collected across the flow, persisted with the state. */
export interface SetupInputs {
  tailscaleAuthKey?: string;
  /** Explicit local-development flow; stable desktop builds reject it. */
  skipTailscale?: boolean;
  sshKeyPath?: string;
  serverIp?: string;
  /** SSH user for the target server; undefined means root. */
  sshUser?: string;
  hostFingerprint?: string;
  /** Exact keyscan line behind the displayed fingerprint. */
  hostKey?: string;
}

export interface SetupError {
  state: SetupState;
  code: SetupErrorCode;
  /** Optional log excerpt shown in the error panel. */
  logExcerpt?: string;
}

/** Schema version for the persisted state (bump on breaking shape changes). */
export const SETUP_STATE_SCHEMA = 2;

export interface SetupMachineState {
  schema: number;
  state: SetupState;
  inputs: SetupInputs;
  error: SetupError | null;
}

export function initialMachineState(): SetupMachineState {
  return { schema: SETUP_STATE_SCHEMA, state: "welcome", inputs: {}, error: null };
}

function indexOf(state: SetupState): number {
  return SETUP_STATES.indexOf(state);
}

/** The next state in the linear flow, or the same state if at the end. */
export function nextState(state: SetupState): SetupState {
  const i = indexOf(state);
  return i < 0 || i >= SETUP_STATES.length - 1 ? state : SETUP_STATES[i + 1];
}

/** The previous state, or the same state if at the beginning. */
export function prevState(state: SetupState): SetupState {
  const i = indexOf(state);
  return i <= 0 ? state : SETUP_STATES[i - 1];
}

export function canGoBack(state: SetupState): boolean {
  return indexOf(state) > 0 && state !== "done";
}

export type SetupAction =
  | { type: "advance"; inputs?: Partial<SetupInputs> }
  | { type: "back" }
  | { type: "fail"; error: Omit<SetupError, "state"> }
  | { type: "clearError" }
  | { type: "reset" };

export function reduce(current: SetupMachineState, action: SetupAction): SetupMachineState {
  switch (action.type) {
    case "advance":
      return {
        ...current,
        inputs: action.inputs ? { ...current.inputs, ...action.inputs } : current.inputs,
        state: nextState(current.state),
        error: null,
      };
    case "back":
      if (!canGoBack(current.state)) return current;
      return { ...current, state: prevState(current.state), error: null };
    case "fail":
      return { ...current, error: { ...action.error, state: current.state } };
    case "clearError":
      return { ...current, error: null };
    case "reset":
      return {
        ...initialMachineState(),
        inputs: {
          sshKeyPath: current.inputs.sshKeyPath,
        },
      };
    default:
      return current;
  }
}

// ── Persistence ──────────────────────────────────────────────────────────────

export const SETUP_STATE_STORAGE_KEY = "hive-setup-state";

export function loadMachineState(): SetupMachineState {
  try {
    const raw = localStorage.getItem(SETUP_STATE_STORAGE_KEY);
    if (!raw) return initialMachineState();
    const parsed = JSON.parse(raw) as Partial<SetupMachineState>;
    // Reject on schema mismatch or an unknown state — start fresh.
    if (parsed.schema !== SETUP_STATE_SCHEMA) return initialMachineState();
    if (!parsed.state || !SETUP_STATES.includes(parsed.state)) return initialMachineState();
    const inputs = { ...(parsed.inputs ?? {}), tailscaleAuthKey: undefined };
    const needsTailscaleKey = !inputs.skipTailscale
      && ["ssh_key", "server", "host_trust", "provisioning"].includes(parsed.state);
    return {
      schema: SETUP_STATE_SCHEMA,
      // The auth key is intentionally not persisted. Re-enter it before any
      // resumed flow that has not completed provisioning yet.
      state: needsTailscaleKey ? "tailscale" : parsed.state,
      // Never restore a Tailscale auth key from durable browser storage.
      inputs,
      error: needsTailscaleKey ? null : (parsed.error ?? null),
    };
  } catch {
    return initialMachineState();
  }
}

export function saveMachineState(state: SetupMachineState): void {
  try {
    localStorage.setItem(
      SETUP_STATE_STORAGE_KEY,
      JSON.stringify({ ...state, inputs: { ...state.inputs, tailscaleAuthKey: undefined } }),
    );
  } catch {
    // ignore quota / serialization errors — persistence is best-effort
  }
}

export function clearMachineState(): void {
  try {
    localStorage.removeItem(SETUP_STATE_STORAGE_KEY);
  } catch {
    // ignore
  }
}
