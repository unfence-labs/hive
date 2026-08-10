import { useSyncExternalStore } from "react";
import type { ProvisionClient } from "@/lib/provision-client";
import { toProvisionError } from "@/lib/provision-client";

/**
 * The in-app server update: `provision.sh --update` over the SSH sidecar,
 * driven from the Updates settings page. Module-level for the same reason as
 * the desktop-update store — the run outlives the page that started it.
 */
export type ServerUpdateState =
  | { phase: "idle" }
  | { phase: "running"; step: string }
  | { phase: "failed"; error: string; passwordRequired: boolean }
  | { phase: "done" };

let state: ServerUpdateState = { phase: "idle" };
const listeners = new Set<() => void>();

/** Shown at most once per app launch; the Updates page is the durable surface. */
let mismatchPrompted = false;

function setState(next: ServerUpdateState): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useServerUpdateState(): ServerUpdateState {
  return useSyncExternalStore(subscribe, () => state);
}

export function shouldPromptServerUpdate(): boolean {
  return !mismatchPrompted;
}

export function markServerUpdatePrompted(): void {
  mismatchPrompted = true;
}

/**
 * Back to a clean slate: called when the client switches servers (a done or
 * failed run describes the previous server) and between tests.
 */
export function resetServerUpdate(): void {
  state = { phase: "idle" };
  mismatchPrompted = false;
}

/** A provisioning run owns the backend; a desktop relaunch would kill it. */
export function serverUpdateInProgress(): boolean {
  return state.phase === "running";
}

/** `probe_os` -> `Probe os`, for a step the script has not titled yet. */
function humanize(id: string): string {
  const words = id.replace(/[_-]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface ServerUpdateTarget {
  host: string;
  /** SSH login. Undefined means root. */
  user?: string;
  keyPath: string;
  /** Escalation password, only when a previous attempt asked for one. */
  password?: string;
}

/**
 * Run the update and resolve with the terminal state. The provisioner owns
 * correctness on the server side (identity checks, health check, rollback);
 * this side only narrates the stream. A failure with `passwordRequired` means
 * the account escalates with a password and the caller should collect one.
 */
export async function runServerUpdate(
  client: ProvisionClient,
  target: ServerUpdateTarget,
): Promise<ServerUpdateState> {
  if (state.phase === "running") return state;
  setState({ phase: "running", step: "Connecting to the server…" });

  try {
    await client.install(
      {
        connection: { host: target.host, user: target.user, keyPath: target.keyPath },
        options: { update: true },
        password: target.password,
      },
      (record) => {
        if (typeof record.step === "string" && record.status === "start") {
          setState({ phase: "running", step: record.title ?? humanize(record.step) });
        }
      },
    );
    setState({ phase: "done" });
  } catch (error) {
    const { code, detail } = toProvisionError(error);
    setState({
      phase: "failed",
      error: detail,
      passwordRequired: code === "SSH_PASSWORD_REQUIRED",
    });
  }
  return state;
}
