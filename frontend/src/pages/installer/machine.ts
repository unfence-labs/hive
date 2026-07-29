import {
  DEFAULT_BACKEND_PORT,
  isValidHost,
  isValidUserName,
  normalizeHost,
} from "@/lib/server-connection";
import type { PrivilegeMode } from "@/lib/provision-client";

/**
 * Installer state machine. Pure and fully testable; `Installer.tsx` owns
 * rendering and side effects.
 *
 * The sequence is linear and reversible up to `review`: nothing before the
 * install touches the server, so there is no point along that stretch at which
 * going back is unsafe. `install` is where that stops — see `InstallScreen`.
 *
 * `accounts` is the other side of that: the install has already succeeded and
 * the server is running. Its durable gate lives on the stored connection, so
 * `Installer.tsx` can restore it independently of this machine.
 */

export const INSTALLER_STATES = [
  "welcome",
  "server",
  "review",
  "install",
  "accounts",
] as const;

export type InstallerState = (typeof INSTALLER_STATES)[number];

/** Defaults mirror `scripts/provision/steps.sh`; changing one means changing both. */
export const DEFAULT_INSTALL_DIR = "/opt/hive";
export const DEFAULT_DATA_DIR = "/home/hive/.hive";

/**
 * Everything the operator declares. The address is the address that reaches
 * the server right now, and it stays the address afterwards — the installer
 * never hands over to a second one.
 */
export interface InstallerInputs {
  /** `host` or `user@host`. Without a user the install logs in as root. */
  address: string;
  port: number;
  installDir: string;
  dataDir: string;
  sshKeyPath?: string;
  /** Public half of the selected key, authorized on the service account. */
  sshPublicKey?: string;
  /** The approved known-hosts line, once the fingerprint has been accepted. */
  hostKey?: string;
  fingerprint?: string;
  /**
   * How the install reaches root, as the connect step's preflight found it.
   * Persisted because it decides whether a relaunch can resume the install
   * unattended or has to ask for the escalation password again.
   */
  privilegeMode?: PrivilegeMode;
}

export interface InstallerMachine {
  schema: number;
  state: InstallerState;
  inputs: InstallerInputs;
}

/** Bump when a shape change would make a stored record misleading. */
export const INSTALLER_SCHEMA = 3;

export const INSTALLER_STORAGE_KEY = "hive-installer-state";

export function defaultInputs(): InstallerInputs {
  return {
    address: "",
    port: DEFAULT_BACKEND_PORT,
    installDir: DEFAULT_INSTALL_DIR,
    dataDir: DEFAULT_DATA_DIR,
  };
}

export function initialMachine(): InstallerMachine {
  return { schema: INSTALLER_SCHEMA, state: "welcome", inputs: defaultInputs() };
}

function indexOf(state: InstallerState): number {
  return INSTALLER_STATES.indexOf(state);
}

export function nextState(state: InstallerState): InstallerState {
  const index = indexOf(state);
  return index < 0 || index >= INSTALLER_STATES.length - 1 ? state : INSTALLER_STATES[index + 1];
}

export function previousState(state: InstallerState): InstallerState {
  const index = indexOf(state);
  return index <= 0 ? state : INSTALLER_STATES[index - 1];
}

export function canGoBack(state: InstallerState): boolean {
  return indexOf(state) > 0;
}

export type InstallerAction =
  | { type: "advance"; inputs?: Partial<InstallerInputs> }
  | { type: "back" }
  | { type: "patch"; inputs: Partial<InstallerInputs> }
  | { type: "reset" };

export function reduce(current: InstallerMachine, action: InstallerAction): InstallerMachine {
  switch (action.type) {
    case "advance":
      return {
        ...current,
        inputs: action.inputs ? { ...current.inputs, ...action.inputs } : current.inputs,
        state: nextState(current.state),
      };
    case "back":
      return canGoBack(current.state)
        ? { ...current, state: previousState(current.state) }
        : current;
    case "patch":
      return { ...current, inputs: { ...current.inputs, ...action.inputs } };
    case "reset":
      return initialMachine();
    default:
      return current;
  }
}

// ── address ──────────────────────────────────────────────────────────────────

/** Split an optional `user@` prefix off the address. */
export function parseAddress(value: string): { host: string; user?: string } {
  const trimmed = value.trim();
  const at = trimmed.lastIndexOf("@");
  if (at === -1) return { host: normalizeHost(trimmed) };
  const user = trimmed.slice(0, at);
  const host = normalizeHost(trimmed.slice(at + 1));
  return user ? { host, user } : { host };
}

/**
 * Shape check only — the same shape the sidecar enforces before it can build an
 * ssh command line. Whether the address actually answers is the server step's
 * verification to run, not this one's.
 */
export function isUsableAddress(value: string): boolean {
  const { host, user } = parseAddress(value);
  return isValidHost(host) && (user === undefined || isValidUserName(user));
}

/** Same rule as `main.sh`: absolute, no traversal, no shell metacharacters. */
export function isUsableDirectory(value: string): boolean {
  return /^(\/[A-Za-z0-9._-]+)+\/?$/.test(value) && !value.includes("..");
}

// ── persistence ──────────────────────────────────────────────────────────────

/**
 * Where a relaunch lands.
 *
 * A run still on the server step has touched nothing durable — only
 * half-typed drafts — so it starts over. Reaching `review` is what proves the
 * server: address, key, approved fingerprint, preflight verdict.
 *
 * Everything past the server step may depend on an escalation password, and
 * that is deliberately not in this record. A run that needs one cannot resume
 * unattended, so it goes back to the server step — with its inputs kept, so
 * one click re-checks the server and asks for the password again. A run that
 * reaches root without one resumes exactly where it stopped, including into an
 * install that was still going: the script is marker-based, so continuing it
 * costs only the steps that are not already done.
 *
 * `accounts` does not need to resume through this record. The stored connection
 * marks setup pending and overrides the restored machine state until Accounts
 * is complete. Resetting this machine to welcome also keeps stale inputs out of
 * the next guided install.
 */
export function resumeState(state: InstallerState, inputs: InstallerInputs): InstallerState {
  if (state === "server" || state === "accounts") return "welcome";
  if (state !== "review" && state !== "install") return state;
  return inputs.privilegeMode === "root" || inputs.privilegeMode === "sudoNoPassword"
    ? state
    : "server";
}

/**
 * Restore where the operator stopped. Anything unreadable, from a different
 * schema, or naming a state that no longer exists starts over rather than
 * resuming into a screen that cannot render its own inputs.
 *
 * The escalation password is never part of this record — it is held in memory
 * for the length of one install and asked for again on the next launch.
 */
export function loadMachine(): InstallerMachine {
  try {
    const raw = localStorage.getItem(INSTALLER_STORAGE_KEY);
    if (!raw) return initialMachine();
    const parsed = JSON.parse(raw) as Partial<InstallerMachine>;
    if (parsed.schema !== INSTALLER_SCHEMA) return initialMachine();
    if (!parsed.state || !INSTALLER_STATES.includes(parsed.state)) return initialMachine();
    const inputs = { ...defaultInputs(), ...(parsed.inputs ?? {}) };
    const state = resumeState(parsed.state, inputs);
    // A resume that lands on welcome is a fresh start — pristine inputs too,
    // so no screen ever opens pre-filled with a previous run's draft.
    if (state === "welcome") return initialMachine();
    return { schema: INSTALLER_SCHEMA, state, inputs };
  } catch {
    return initialMachine();
  }
}

export function saveMachine(machine: InstallerMachine): void {
  try {
    localStorage.setItem(INSTALLER_STORAGE_KEY, JSON.stringify(machine));
  } catch {
    // Persistence is best-effort; a full quota must not break the installer.
  }
}

export function clearMachine(): void {
  try {
    localStorage.removeItem(INSTALLER_STORAGE_KEY);
  } catch {
    // ignore
  }
}
