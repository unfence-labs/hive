import type { SetupErrorCode } from "@hive/shared/setup-errors";
import { isTauri } from "@/lib/is-tauri";

/**
 * Abstraction over the SSH sidecar (Tauri + Rust commands spawning the system
 * `ssh` binary) that drives `provision.sh` on the target server.
 */

/** A discovered SSH key candidate under ~/.ssh (or a picked file). */
export interface SshKey {
  /** Absolute path to the private key file. Only the path is ever stored. */
  path: string;
  /** Display label, e.g. "id_ed25519". */
  label: string;
  /** Best-effort key type when known (ed25519, rsa, …). */
  type?: string;
  /** True when the file is passphrase-protected. */
  encrypted?: boolean;
  /** True when the encrypted key is already usable by non-interactive SSH. */
  agentLoaded?: boolean;
  /** Public key text when readable without a passphrase. */
  publicKey?: string;
}

export interface ProvisionParams {
  host: string;
  /** SSH user to connect as; defaults to root. Non-root users need passwordless sudo. */
  user?: string;
  keyPath: string;
  /** Tailscale auth key (tskey-...), streamed over SSH stdin, never argv. */
  tailscaleAuthKey: string;
  port?: number;
  /** Explicit local-development mode. Stable builds reject true. */
  skipTailscale: boolean;
}

/**
 * A provision progress event. Mirrors the NDJSON protocol but normalized into
 * a tagged union the wizard renders directly.
 */
export type ProvisionEvent =
  | {
      kind: "run_start";
      seq: number;
      runId: string;
      scriptVersion: string;
      resume: boolean;
      stepsPlanned: string[];
    }
  | { kind: "step_start"; seq: number; step: string; title: string }
  | { kind: "step_log"; seq: number; step: string; line: string; stream?: "stdout" | "stderr" }
  | { kind: "step_ok"; seq: number; step: string; durationMs?: number; data?: Record<string, unknown> }
  | { kind: "step_skip"; seq: number; step: string; reason?: string; data?: Record<string, unknown> }
  | {
      kind: "step_error";
      seq: number;
      step: string;
      exitCode?: number;
      errorCode: SetupErrorCode;
      detail?: string;
    }
  | {
      kind: "run_end";
      seq: number;
      status: "ok" | "error";
      /** Present on SSH-level failures where no step_error was emitted. */
      errorCode?: SetupErrorCode;
      detail?: string;
    };

export type TestConnectionResult =
  | { fingerprint: string; hostKey: string }
  | { error: SetupErrorCode };

export interface ProvisionClient {
  /** Discover candidate SSH keys under ~/.ssh. */
  listKeys(): Promise<SshKey[]>;
  /**
   * Fetch the server's host key: the SHA256 fingerprint for the TOFU dialog
   * plus the exact selected keyscan line behind it, or an error code.
   */
  testConnection(host: string): Promise<TestConnectionResult>;
  /**
   * Persist the exact approved key. For a new tailnet address, omit hostKey and
   * pass expectedHostKey so the rescan must identify the same server key.
   */
  trustHost(host: string, hostKey?: string, expectedHostKey?: string): Promise<void>;
  /** Start provisioning; yields NDJSON-derived events until run_end. */
  startProvision(params: ProvisionParams): AsyncIterable<ProvisionEvent>;
  /**
   * Local Claude sign-in, fully in-app: start spawns `claude setup-token` in a
   * PTY (the CLI opens the browser); the user pastes the browser's code into
   * the app and complete forwards it to the CLI. The token is delivered by
   * pollClaudeAuth — the single path that watches the CLI output.
   */
  startClaudeAuth(): Promise<{ url?: string }>;
  completeClaudeAuth(code: string): Promise<void>;
  pollClaudeAuth(): Promise<{ token?: string; exited: boolean; detail?: string }>;
  cancelClaudeAuth(): Promise<void>;
}

// ── Tauri implementation (system-ssh sidecar in Rust) ────────────────────────

/** Raw NDJSON line forwarded by the Rust sidecar. `status` is a step status
 * on step lines and "ok" | "error" on run_end lines. */
interface NdjsonLine {
  seq: number;
  event?: "run_start" | "run_end";
  step?: string;
  status?: string;
  title?: string;
  line?: string;
  reason?: string;
  durationMs?: number;
  exitCode?: number;
  errorCode?: SetupErrorCode;
  detail?: string;
  runId?: string;
  scriptVersion?: string;
  resume?: boolean;
  stepsPlanned?: string[];
  data?: Record<string, unknown>;
}

/** Normalize a raw NDJSON line into the wizard's tagged ProvisionEvent union. */
export function ndjsonToEvent(o: NdjsonLine): ProvisionEvent | null {
  if (o.event === "run_start") {
    return {
      kind: "run_start",
      seq: o.seq,
      runId: o.runId ?? "",
      scriptVersion: o.scriptVersion ?? "",
      resume: o.resume ?? false,
      stepsPlanned: o.stepsPlanned ?? [],
    };
  }
  if (o.event === "run_end") {
    const succeeded = o.status === "ok";
    return {
      kind: "run_end",
      seq: o.seq,
      status: succeeded ? "ok" : "error",
      errorCode: succeeded ? o.errorCode : (o.errorCode ?? "UNKNOWN"),
      detail: succeeded
        ? o.detail
        : (o.detail ?? (o.status === "error"
            ? "Provisioning failed without an error detail."
            : `Invalid provision completion status: ${o.status ?? "missing"}`)),
    };
  }
  if (!o.step) return null;
  switch (o.status) {
    case "start":
      return { kind: "step_start", seq: o.seq, step: o.step, title: o.title ?? o.step };
    case "log":
      return { kind: "step_log", seq: o.seq, step: o.step, line: o.line ?? "" };
    case "ok":
      return { kind: "step_ok", seq: o.seq, step: o.step, durationMs: o.durationMs, data: o.data };
    case "skip":
      return { kind: "step_skip", seq: o.seq, step: o.step, reason: o.reason, data: o.data };
    case "error":
      return {
        kind: "step_error",
        seq: o.seq,
        step: o.step,
        exitCode: o.exitCode,
        errorCode: o.errorCode ?? "UNKNOWN",
        detail: o.detail,
      };
    default:
      return null;
  }
}

/**
 * Real client backed by the Rust SSH sidecar. `provision_start` streams NDJSON
 * over a Tauri Channel; we bridge that channel to an AsyncIterable and
 * normalize each line via {@link ndjsonToEvent}.
 */
export function createTauriProvisionClient(): ProvisionClient {
  async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  }

  async function* streamCommand(params: ProvisionParams): AsyncIterable<ProvisionEvent> {
    const { Channel } = await import("@tauri-apps/api/core");
    const channel = new Channel<NdjsonLine>();
    const queue: ProvisionEvent[] = [];
    let wake: (() => void) | null = null;
    let done = false;
    let failure: unknown = null;

    channel.onmessage = (raw) => {
      const ev = ndjsonToEvent(raw);
      if (ev) queue.push(ev);
      wake?.();
    };

    const invocation = invoke<void>("provision_start", { params, onEvent: channel })
      .catch((e) => {
        failure = e;
      })
      .finally(() => {
        done = true;
        wake?.();
      });

    while (true) {
      while (queue.length) yield queue.shift() as ProvisionEvent;
      if (done) break;
      await new Promise<void>((r) => {
        wake = r;
      });
    }
    await invocation;
    if (failure) throw new Error(String(failure));
  }

  return {
    async listKeys() {
      return invoke<SshKey[]>("provision_list_keys");
    },
    async testConnection(host) {
      return invoke<TestConnectionResult>("provision_test_connection", { host });
    },
    async trustHost(host, hostKey, expectedHostKey) {
      await invoke("provision_trust_host", { host, hostKey, expectedHostKey });
    },
    startProvision(params) {
      return streamCommand(params);
    },
    async startClaudeAuth() {
      return invoke<{ url?: string }>("claude_auth_start");
    },
    async completeClaudeAuth(code) {
      await invoke("claude_auth_code", { code });
    },
    async pollClaudeAuth() {
      const r = await invoke<{ token: string | null; exited: boolean; detail: string | null }>(
        "claude_auth_poll",
      );
      return { token: r.token ?? undefined, exited: r.exited, detail: r.detail ?? undefined };
    },
    async cancelClaudeAuth() {
      await invoke("claude_auth_cancel");
    },
  };
}

/** Provisioning is a desktop-only capability. Tests inject their own client. */
export function createProvisionClient(): ProvisionClient {
  if (isTauri()) return createTauriProvisionClient();
  throw new Error("Server provisioning is only available in the Hive desktop app.");
}
