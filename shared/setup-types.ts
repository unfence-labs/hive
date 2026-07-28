/**
 * Contract for the tool detection / install / update API.
 *
 * Hive drives agent CLIs that live on the server, so an operator needs to see
 * their state and repair it without opening a terminal. The backend owns the
 * detection and the long-running install/update work; every client reads the
 * same shapes from here.
 *
 * This is deliberately NOT the provisioning taxonomy in `setup-errors.ts`.
 * Those codes describe a bare server being turned into a Hive host and are
 * contract-tested against `scripts/provision/lib.sh`; these describe one CLI
 * being installed on an already-running host. Fusing them would force the
 * shell script to declare reasons it can never emit.
 */

/** Tools Hive depends on, in the order a panel should present them. */
export const SETUP_TOOL_IDS = ["claude", "codex", "gh"] as const;

export type SetupToolId = (typeof SETUP_TOOL_IDS)[number];

export function isSetupToolId(value: string): value is SetupToolId {
  return (SETUP_TOOL_IDS as readonly string[]).includes(value);
}

export const TOOL_OPERATION_KINDS = ["install", "update"] as const;

export type ToolOperationKind = (typeof TOOL_OPERATION_KINDS)[number];

export interface ToolStatus {
  id: SetupToolId;
  label: string;
  installed: boolean;
  /** Version reported by the tool itself, null when absent or unparseable. */
  version: string | null;
  /** Latest published version, null when it could not be looked up. */
  latestVersion: string | null;
  updateAvailable: boolean;
  /** Whether the tool is signed in. Reported here; performed elsewhere. */
  authenticated: boolean;
  /**
   * Whether Hive can install or update this tool itself. False for tools whose
   * only trustworthy install path is the provisioning script (`gh` ships as a
   * checksum-pinned tarball, and re-deriving that here would duplicate the
   * pinned digests in a second language).
   */
  managed: boolean;
}

/**
 * Coarse progress. The package managers behind these operations do not emit
 * anything a UI can turn into a percentage, so this reports the phase rather
 * than inventing a bar that lies.
 */
export type ToolOperationPhase = "detecting" | "running" | "verifying" | "done";

export type ToolOperationStatus = "running" | "succeeded" | "failed";

/**
 * Why an operation failed, in terms an operator can act on. `network` and
 * `command_failed` are the load-bearing split: an unreachable registry is
 * fixed on the server's network, a non-zero exit is fixed by reading what the
 * command actually said.
 */
export type ToolFailureReason =
  | "network"
  | "command_failed"
  | "timeout"
  | "not_on_path"
  | "interrupted";

export const TOOL_FAILURE_HINTS: Record<ToolFailureReason, string> = {
  network:
    "The server could not reach the package registry. Check its network and DNS, then try again.",
  command_failed:
    "The install command ran and failed. The output below says why.",
  timeout:
    "The install command was still running after the time limit and was stopped. Try again; a slow network is the usual cause.",
  not_on_path:
    "The install reported success but the executable is still not on the service account's PATH. Re-run the installer on the server.",
  interrupted:
    "Hive restarted while this was running. Completed work is detected and skipped, so simply start it again.",
};

export interface ToolOperationFailure {
  reason: ToolFailureReason;
  message: string;
  /**
   * Bounded tail of the command's real output. Bounded because the whole point
   * is to be readable, and because it is held in memory and written to the
   * server's state file.
   */
  outputExcerpt?: string;
}

export interface ToolOperation {
  id: string;
  tool: SetupToolId;
  kind: ToolOperationKind;
  status: ToolOperationStatus;
  phase: ToolOperationPhase;
  startedAt: string;
  finishedAt?: string;
  failure?: ToolOperationFailure;
}

export interface ToolsResponse {
  tools: ToolStatus[];
  /**
   * The most recent operation per tool, running or recently finished. A client
   * that reconnects with no operation id in hand still finds work in flight
   * here, which is what makes navigating away from the panel safe.
   */
  operations: ToolOperation[];
  /**
   * Sign-in flows the backend drives, at most one per tool. Carried alongside
   * the tools for the same reason operations are: the panel polls one endpoint,
   * and a client that reloads mid-sign-in still finds the code it must enter.
   */
  authSessions: ToolAuthSession[];
}

/**
 * Cheap progress poll. Everything here is served from memory; none of the
 * detection work behind {@link ToolsResponse} runs. Clients poll this while an
 * operation or sign-in is live and refetch the full tools list once when
 * something reaches a terminal state.
 */
export interface SetupStatusResponse {
  operations: ToolOperation[];
  authSessions: ToolAuthSession[];
}

export interface StartToolOperationResponse {
  operation: ToolOperation;
  /** True when the request attached to an operation that was already running. */
  joined: boolean;
}

/** Upper bound on a persisted/serialised command excerpt, in characters. */
export const TOOL_OUTPUT_EXCERPT_MAX = 2_000;

// ── Sign-in ──────────────────────────────────────────────────────────
//
// The backend drives every sign-in, keyed by SetupToolId. How it drives one
// is the flow's own business: the agent CLIs are supervised child processes,
// GitHub is Hive speaking the provider's device-code endpoints itself. The
// session shapes below describe the operator's side, which is the same either
// way.

/**
 * Where a sign-in has got to.
 *
 * `awaiting_authorization` and `awaiting_code` are both "the operator has
 * something to do", but they are not the same something: the first is waiting
 * on a browser confirmation the provider reports back over its own channel,
 * the second cannot progress until a code is handed to the CLI's stdin.
 */
export type ToolAuthState =
  | "starting"
  | "awaiting_authorization"
  | "awaiting_code"
  | "verifying"
  | "connected"
  | "expired"
  | "cancelled"
  | "failed";

export const TOOL_AUTH_TERMINAL_STATES: readonly ToolAuthState[] = [
  "connected",
  "expired",
  "cancelled",
  "failed",
];

export function isToolAuthTerminal(state: ToolAuthState): boolean {
  return TOOL_AUTH_TERMINAL_STATES.includes(state);
}

/**
 * Why a sign-in did not end connected. `expired` is a state rather than a
 * failure reason (a code that ran out is not a malfunction), so it does not
 * appear here.
 */
export type ToolAuthFailureReason =
  | "not_installed"
  | "unsupported_cli"
  | "command_failed"
  | "no_credential";

export const TOOL_AUTH_FAILURE_HINTS: Record<ToolAuthFailureReason, string> = {
  not_installed:
    "The tool is not installed on this server. Install it above, then sign in.",
  unsupported_cli:
    "The installed CLI is too old for this sign-in flow. Update it above, then try again.",
  command_failed: "The sign-in command ran and failed. The output below says why.",
  no_credential:
    "The sign-in finished but left no usable credential. Start it again, or paste a token directly.",
};

export interface ToolAuthFailure {
  reason: ToolAuthFailureReason;
  message: string;
  /** Bounded tail of the command's output, with any credential redacted. */
  outputExcerpt?: string;
}

export interface ToolAuthSession {
  tool: SetupToolId;
  state: ToolAuthState;
  /** Page the operator opens to authorise. */
  verificationUri?: string;
  /** One-time code to enter at {@link verificationUri}, when the flow uses one. */
  userCode?: string;
  /** True while the flow cannot progress until a code is submitted back. */
  needsCode: boolean;
  /**
   * A non-terminal message about the last attempt (e.g. a code the provider
   * rejected); the flow is still live and can still end connected.
   */
  notice?: string;
  startedAt: string;
  /** When the surfaced code stops being accepted, if the provider bounds it. */
  expiresAt?: string;
  finishedAt?: string;
  failure?: ToolAuthFailure;
}

/**
 * Returned by a start request that Hive refused to run because running it
 * would destroy something. Codex deletes its stored credential the moment the
 * device flow begins, so an operator who is already signed in has to say yes
 * to being signed out first.
 */
export interface ToolAuthConfirmationRequired {
  code: "confirm_required";
  message: string;
}
