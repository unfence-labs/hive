import {
  isToolAuthTerminal,
  type SetupToolId,
  type ToolAuthSession,
  type ToolAuthState,
} from "@hive/shared/setup-types";
import { detectAvailableProviders } from "../../../agents/providers/registry.js";
import { invalidateProviderUsage } from "../../provider-usage.js";
import { runCommand } from "../command.js";
import { defaultDetectDeps, detectTool, type DetectDeps, type ToolDetection } from "../detect.js";
import { findToolSpec } from "../catalog.js";
import { claudeAuthFlow } from "./claude.js";
import { codexAuthFlow, recoverCodexCredential } from "./codex.js";
import { githubAuthFlow } from "./github.js";
import { ToolAuthError, type AuthFlow, type AuthFlowHandle } from "./flow.js";
import { makeClaudeTokenWriter } from "./secrets.js";

/** How long a finished sign-in stays on the panel before it is forgotten. */
const DEFAULT_RETENTION_MS = 10 * 60_000;

export interface ToolAuthFlowSpec {
  flow: AuthFlow;
}

export type ToolAuthFlows = Partial<Record<SetupToolId, ToolAuthFlowSpec>>;

export interface ToolAuthStoreOptions {
  flows: ToolAuthFlows;
  /** Called after a sign-in lands, so anything gated on providers re-reads. */
  onConnected?: (tool: SetupToolId) => Promise<void>;
  onUnexpectedError?: (tool: SetupToolId, error: unknown) => void;
  now?: () => number;
  retentionMs?: number;
}

export interface ToolAuthStore {
  list: () => ToolAuthSession[];
  /** Begin a sign-in, or return the one already running for the tool. */
  start: (tool: SetupToolId) => Promise<ToolAuthSession>;
  /** Hand a pasted code to the flow. Throws when it is not waiting for one. */
  submitCode: (tool: SetupToolId, code: string) => ToolAuthSession;
  cancel: (tool: SetupToolId) => ToolAuthSession | null;
  /** Resolves once no sign-in is in flight. Test seam. */
  whenIdle: () => Promise<void>;
}

/**
 * Sign-in sessions, one per tool.
 *
 * Unlike installs, these are held only in memory. A sign-in is a live
 * conversation with a child process and a browser; when the backend restarts,
 * that process is gone and no record could make it resumable. Writing one to
 * disk would only produce a session that claims to be waiting for a code
 * nothing will ever read. What does survive a restart is the Codex credential
 * a half-finished flow deleted, and `recoverCodexCredential` puts that back.
 */
export function createToolAuthStore(options: ToolAuthStoreOptions): ToolAuthStore {
  const now = options.now ?? Date.now;
  const retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
  const sessions = new Map<SetupToolId, ToolAuthSession>();
  const handles = new Map<SetupToolId, AuthFlowHandle>();
  const inFlight = new Set<Promise<void>>();

  function prune(): void {
    const cutoff = now() - retentionMs;
    for (const [tool, session] of sessions) {
      if (!isToolAuthTerminal(session.state)) continue;
      if (session.finishedAt && Date.parse(session.finishedAt) <= cutoff) {
        sessions.delete(tool);
      }
    }
  }

  function settle(session: ToolAuthSession, state: ToolAuthState): void {
    session.state = state;
    session.needsCode = false;
    session.finishedAt = new Date(now()).toISOString();
  }

  return {
    list() {
      prune();
      return structuredClone([...sessions.values()]);
    },

    async start(tool) {
      prune();
      const spec = options.flows[tool];
      if (!spec) {
        throw new ToolAuthError("unsupported_cli", `Hive cannot sign in to ${tool}.`);
      }

      const existing = sessions.get(tool);
      if (existing && !isToolAuthTerminal(existing.state)) {
        return structuredClone(existing);
      }

      const session: ToolAuthSession = {
        tool,
        state: "starting",
        needsCode: false,
        startedAt: new Date(now()).toISOString(),
      };
      sessions.set(tool, session);

      const handle = spec.flow({
        prompt: (info) => {
          if (isToolAuthTerminal(session.state)) return;
          session.verificationUri = info.verificationUri;
          if (info.userCode) session.userCode = info.userCode;
          if (info.expiresAt) session.expiresAt = info.expiresAt.toISOString();
          session.needsCode = info.needsCode === true;
          // Assigned unconditionally: a fresh prompt must not keep the last
          // attempt's complaint on screen.
          session.notice = info.notice;
          session.state = info.needsCode ? "awaiting_code" : "awaiting_authorization";
        },
        setState: (state) => {
          if (isToolAuthTerminal(session.state)) return;
          session.state = state;
          if (state === "verifying") session.needsCode = false;
        },
      });
      handles.set(tool, handle);

      const task = handle.done
        .then(async (outcome) => {
          if (outcome === "connected") {
            try {
              await options.onConnected?.(tool);
            } catch (error) {
              options.onUnexpectedError?.(
                tool,
                new Error(`Provider refresh after ${tool} sign-in failed.`, { cause: error }),
              );
            }
          }
          settle(session, outcome);
        })
        .catch((error: unknown) => {
          settle(session, "failed");
          if (error instanceof ToolAuthError) {
            session.failure = {
              reason: error.reason,
              message: error.message,
              ...(error.outputExcerpt ? { outputExcerpt: error.outputExcerpt } : {}),
            };
          } else {
            session.failure = {
              reason: "command_failed",
              message: error instanceof Error ? error.message : String(error),
            };
            options.onUnexpectedError?.(tool, error);
          }
        })
        .finally(() => {
          handles.delete(tool);
          inFlight.delete(task);
        });
      inFlight.add(task);

      return structuredClone(session);
    },

    submitCode(tool, code) {
      const session = sessions.get(tool);
      const handle = handles.get(tool);
      if (!session || !handle || isToolAuthTerminal(session.state)) {
        throw new Error(`No ${tool} sign-in is waiting for a code.`);
      }
      session.notice = undefined;
      handle.submitCode(code);
      return structuredClone(session);
    },

    cancel(tool) {
      const session = sessions.get(tool);
      if (!session) return null;
      handles.get(tool)?.cancel();
      if (!isToolAuthTerminal(session.state)) settle(session, "cancelled");
      return structuredClone(session);
    },

    async whenIdle() {
      while (inFlight.size > 0) await Promise.all([...inFlight]);
    },
  };
}

/**
 * The sign-in flows Hive ships, wired to the real CLIs and, for GitHub, to
 * GitHub's own device-code endpoints.
 *
 * Starting a flow over a working credential needs no confirmation: the Codex
 * flow backs the credential up first and puts it back when the sign-in ends
 * any way but connected.
 */
export function defaultToolAuthStore(
  dataDir: string,
  onUnexpectedError?: (tool: SetupToolId, error: unknown) => void,
): ToolAuthStore {
  const detectDeps: DetectDeps = defaultDetectDeps();
  const detect = async (tool: SetupToolId): Promise<ToolDetection> =>
    detectTool(findToolSpec(tool), detectDeps);

  void recoverCodexCredential().catch(() => {
    // Nothing to restore, or the credential directory is not writable. Either
    // way the panel reports Codex as signed out and the operator can retry.
  });

  return createToolAuthStore({
    onConnected: async (tool) => {
      if (tool === "claude" || tool === "codex") {
        invalidateProviderUsage(tool);
      }
      await detectAvailableProviders();
    },
    onUnexpectedError,
    flows: {
      claude: {
        flow: claudeAuthFlow({
          detect: () => detect("claude"),
          writeToken: makeClaudeTokenWriter(dataDir),
        }),
      },
      codex: {
        flow: codexAuthFlow({ detect: () => detect("codex"), run: runCommand }),
      },
      gh: {
        flow: githubAuthFlow({ detect: () => detect("gh") }),
      },
    },
  });
}
