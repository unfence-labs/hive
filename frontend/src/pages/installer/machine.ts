import { DEFAULT_BACKEND_PORT } from "@/lib/server-connection";

/**
 * Installer state machine. Pure and fully testable; `Installer.tsx` owns
 * rendering and side effects.
 *
 * The sequence is linear and freely reversible: nothing on these screens
 * touches the server, so there is no point at which going back is unsafe.
 */

export const INSTALLER_STATES = ["welcome", "network", "ssh_key", "connect", "install"] as const;

export type InstallerState = (typeof INSTALLER_STATES)[number];

/** How the server will be exposed. Declared by the operator, never inferred. */
export type NetworkMode = "public" | "tailnet";

/** Defaults mirror `scripts/provision/steps.sh`; changing one means changing both. */
export const DEFAULT_INSTALL_DIR = "/opt/hive";
export const DEFAULT_DATA_DIR = "/home/hive/.hive";
export const DEFAULT_TAILNET_INTERFACE = "tailscale0";

/**
 * Everything the operator declares. The address is the address that reaches
 * the server right now, and it stays the address afterwards — the installer
 * never hands over to a second one.
 */
export interface InstallerInputs {
  networkMode: NetworkMode;
  /** `host` or `user@host`. Without a user the install logs in as root. */
  address: string;
  port: number;
  installDir: string;
  dataDir: string;
  tailnetInterface: string;
  sshKeyPath?: string;
  /** Public half of the selected key, authorized on the service account. */
  sshPublicKey?: string;
  /** The approved known-hosts line, once the fingerprint has been accepted. */
  hostKey?: string;
  fingerprint?: string;
}

export interface InstallerMachine {
  schema: number;
  state: InstallerState;
  inputs: InstallerInputs;
}

/** Bump when a shape change would make a stored record misleading. */
export const INSTALLER_SCHEMA = 1;

export const INSTALLER_STORAGE_KEY = "hive-installer-state";

export function defaultInputs(): InstallerInputs {
  return {
    networkMode: "public",
    address: "",
    port: DEFAULT_BACKEND_PORT,
    installDir: DEFAULT_INSTALL_DIR,
    dataDir: DEFAULT_DATA_DIR,
    tailnetInterface: DEFAULT_TAILNET_INTERFACE,
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
  if (at === -1) return { host: trimmed };
  const user = trimmed.slice(0, at);
  const host = trimmed.slice(at + 1);
  return user ? { host, user } : { host };
}

/**
 * Shape check only — the same shape the sidecar enforces before it can build an
 * ssh command line. Whether the address actually answers is the connect step's
 * job, not this one's.
 */
export function isUsableAddress(value: string): boolean {
  const { host, user } = parseAddress(value);
  if (!host || host.startsWith("-") || !/^[A-Za-z0-9.:-]+$/.test(host)) return false;
  return user === undefined || /^[A-Za-z_][A-Za-z0-9._-]*$/.test(user);
}

/** Same rule as `main.sh`: absolute, no traversal, no shell metacharacters. */
export function isUsableDirectory(value: string): boolean {
  return /^(\/[A-Za-z0-9._-]+)+\/?$/.test(value) && !value.includes("..");
}

// ── persistence ──────────────────────────────────────────────────────────────

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
    return {
      schema: INSTALLER_SCHEMA,
      // Everything past the connect step may depend on an escalation password,
      // and that is deliberately not in this record. Resuming lands on connect,
      // which establishes the privilege mode and asks again if it has to.
      state: parsed.state === "install" ? "connect" : parsed.state,
      inputs: { ...defaultInputs(), ...(parsed.inputs ?? {}) },
    };
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
