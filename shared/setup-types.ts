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
}

export interface StartToolOperationResponse {
  operation: ToolOperation;
  /** True when the request attached to an operation that was already running. */
  joined: boolean;
}

/** Upper bound on a persisted/serialised command excerpt, in characters. */
export const TOOL_OUTPUT_EXCERPT_MAX = 2_000;
