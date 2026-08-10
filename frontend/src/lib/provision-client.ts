import {
  SETUP_ERROR_HINTS,
  SSH_ERROR_HINTS,
  isSetupErrorCode,
  isSshErrorCode,
} from "@hive/shared/setup-errors";
import { isDesktopShell } from "@/lib/is-desktop";

/**
 * Typed surface over the desktop shell's SSH sidecar
 * (`frontend/src-tauri/src/provision.rs`). Every shape here mirrors a `Serialize`
 * struct on that side; keep the two in step.
 */

/** A private key found under ~/.ssh. Only the path is ever stored. */
export interface SshKey {
  path: string;
  /** File name, e.g. "id_ed25519". */
  label: string;
  keyType?: string;
  /** Passphrase-protected. */
  encrypted: boolean;
  agentLoaded: boolean;
  /** Can authenticate without a prompt: no passphrase, or held by an agent. */
  usable: boolean;
  publicKey?: string;
}

/** The server's SSH identity, as scanned before anything is sent to it. */
export interface HostIdentity {
  /** The exact known-hosts line the fingerprint was computed from. */
  hostKey: string;
  fingerprint: string;
  keyType: string;
  /** Already present in Hive's own known-hosts file, byte for byte. */
  trusted: boolean;
}

export type PreflightStatus = "ok" | "warn" | "fail";

export interface PreflightCheck {
  /** Check id, e.g. "port", "install_dir", or "firewall". */
  check: string;
  status: PreflightStatus;
  detail: string;
  data?: Record<string, unknown>;
}

/** How the install would gain root, as preflight found it — never as we guess. */
export type PrivilegeMode = "root" | "sudoNoPassword" | "sudoPassword";

export interface PrivilegeFinding {
  mode: PrivilegeMode;
}

export interface PreflightReport {
  ok: boolean;
  /** Ids of the checks that failed. */
  blockers: string[];
  checks: PreflightCheck[];
  privilege: PrivilegeFinding;
}

export interface ProvisionConnection {
  host: string;
  /** Login account. Undefined means root. */
  user?: string;
  keyPath: string;
}

export interface ProvisionOptions {
  port?: number;
  installDir?: string;
  dataDir?: string;
  /** Authorized on the hive service account by the install. */
  sshPublicKey?: string;
  /**
   * Update an existing completed install to the app's version instead of
   * installing. The script reads everything else from the server's install
   * manifest, so no other option applies.
   */
  update?: boolean;
}

/** The sidecar's rejection shape: a taxonomy code plus a raw diagnostic. */
export interface ProvisionError {
  code: string;
  detail: string;
}

export function isProvisionError(value: unknown): value is ProvisionError {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ProvisionError>;
  return typeof candidate.code === "string" && typeof candidate.detail === "string";
}

/**
 * Normalize anything a rejected command threw into `{ code, detail }`, so the
 * UI never has to render a stringified object or an empty message.
 */
export function toProvisionError(error: unknown): ProvisionError {
  if (isProvisionError(error)) return error;
  if (error instanceof Error) return { code: "UNKNOWN", detail: error.message };
  return { code: "UNKNOWN", detail: String(error) };
}

/** What to do about an error code, from the shared taxonomy. */
export function provisionErrorHint(code: string): string {
  if (isSshErrorCode(code)) return SSH_ERROR_HINTS[code];
  if (isSetupErrorCode(code)) return SETUP_ERROR_HINTS[code];
  return SETUP_ERROR_HINTS.UNKNOWN;
}

// ── install stream ───────────────────────────────────────────────────────────

/**
 * One raw NDJSON record as `scripts/provision/lib.sh` emits it and the sidecar
 * forwards it, verbatim. Kept raw here so the transport stays a transport: the
 * installer's reducer is the only place that interprets these.
 */
export interface ProvisionRecord {
  seq?: number;
  event?: string;
  step?: string;
  status?: string;
  title?: string;
  line?: string;
  errorCode?: string;
  detail?: string;
  resume?: boolean;
  stepsPlanned?: string[];
  data?: Record<string, unknown>;
}

export interface InstallRequest {
  connection: ProvisionConnection;
  options: ProvisionOptions;
  /**
   * Escalation password, only when preflight said the account needs one. Held
   * in memory for the length of one run and never written anywhere.
   */
  password?: string;
}

export interface ProvisionClient {
  /** Private keys under ~/.ssh, usable and unusable alike. */
  listKeys(): Promise<SshKey[]>;
  /** Scan the server's host key. Nothing else touches the host until approval. */
  testConnection(host: string): Promise<HostIdentity>;
  /** Record the approved key in Hive's own known-hosts file. */
  trustHost(host: string, hostKey: string): Promise<void>;
  /** Run the provisioning script's read-only preflight over that connection. */
  preflight(
    connection: ProvisionConnection,
    options: ProvisionOptions,
  ): Promise<PreflightReport>;
  /**
   * Run the install, streaming every record the script emits. Resolves when the
   * run ends and rejects with a {@link ProvisionError} when it fails; the stream
   * carries its own terminal `run_end` either way.
   */
  install(
    request: InstallRequest,
    onRecord: (record: ProvisionRecord) => void,
  ): Promise<void>;
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(command, args);
}

export function createTauriProvisionClient(): ProvisionClient {
  return {
    listKeys: () => invoke<SshKey[]>("provision_list_keys"),
    testConnection: (host) => invoke<HostIdentity>("provision_test_connection", { host }),
    trustHost: async (host, hostKey) => {
      await invoke("provision_trust_host", { host, hostKey });
    },
    preflight: (connection, options) =>
      invoke<PreflightReport>("provision_preflight", { connection, options }),
    install: async ({ connection, options, password }, onRecord) => {
      const core = await import("@tauri-apps/api/core");
      const channel = new core.Channel<ProvisionRecord>();
      channel.onmessage = onRecord;
      await core.invoke("provision_start", {
        connection,
        options,
        // Explicitly null rather than absent: the sidecar's `Option<Secret>`
        // reads both as "no password", and null says so on the wire.
        password: password ?? null,
        onEvent: channel,
      });
    },
  };
}

/** Installing a server is a desktop capability. Tests inject their own client. */
export function createProvisionClient(): ProvisionClient {
  if (!isDesktopShell()) {
    throw new Error("Installing a Hive server is only available in the desktop app.");
  }
  return createTauriProvisionClient();
}
