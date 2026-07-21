import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, CopyIcon, ExternalLink } from "lucide-react";
import { ErrorPanel } from "./ErrorPanel";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { createSetupApi, pollOperation, SetupApiError } from "@/hooks/useSetupApi";
import { invalidateModelCatalog } from "@/hooks/useModels";
import { copyToClipboard } from "@/lib/clipboard";
import { openExternal } from "@/lib/open-external";
import { isTauri } from "@/lib/is-tauri";
import { createProvisionClient, type ProvisionClient } from "@/lib/provision-client";
import type { SetupStatus, SetupOperation, SetupStepAction } from "@hive/shared/setup-types";
import type { SetupError } from "@/pages/setup/machine";
import { cn } from "@/lib/utils";

/** Device code with a one-click copy affordance. */
function DeviceCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <p className="mt-1 flex items-center gap-2">
      Code: <code className="rounded bg-muted px-1 font-mono">{code}</code>
      <button
        type="button"
        aria-label="Copy code"
        onClick={() => {
          void copyToClipboard(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
      >
        {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-success-foreground" /> : <CopyIcon className="h-3.5 w-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </p>
  );
}

/** Render the device-code action emitted by an authentication step. */
export function OperationActions({ op }: { op: SetupOperation }) {
  const actionable = op.steps
    .map((step) => ({ step, action: step.action }))
    .filter((e): e is { step: SetupOperation["steps"][number]; action: SetupStepAction } => !!e.action);
  const openedRef = useRef<Set<string>>(new Set());

  // Open each action URL in the browser once, so the user only has to enter the code.
  useEffect(() => {
    for (const { action } of actionable) {
      if (openedRef.current.has(action.url)) continue;
      openedRef.current.add(action.url);
      void openExternal(action.url);
    }
  }, [actionable]);

  if (actionable.length === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      {actionable.map(({ step, action }) => {
        return (
          <div key={step.id} className="rounded border border-border/50 bg-card/50 p-3 text-xs">
            <p className="font-medium text-foreground">{step.title}</p>
            <a
              href={action.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-primary hover:underline"
            >
              {action.url} <ExternalLink className="h-3 w-3" />
            </a>
            <DeviceCode code={action.code} />
          </div>
        );
      })}
    </div>
  );
}

function Connected({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-success-foreground">
      <CheckCircle2 className="h-4 w-4" /> {label} connected
    </div>
  );
}

/** Fallback path: run `claude setup-token` yourself and paste the token. */
export function ClaudeTokenCommand() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="rounded bg-muted px-2 py-1 font-mono text-xs">claude setup-token</code>
      <button
        type="button"
        aria-label="Copy command"
        onClick={() => {
          void copyToClipboard("claude setup-token");
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-success-foreground" /> : <CopyIcon className="h-3.5 w-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/**
 * Fully in-app Claude sign-in: the app drives `claude setup-token` in a local
 * PTY (the browser opens) and watches its output for the token — the single
 * delivery path, whether the browser flow completes silently or the user
 * pastes a code. Falls back to the manual command + token paste for web builds
 * or if the CLI is missing.
 */
export function ClaudeSignIn({
  client,
  submitToken,
  onError,
  onAttempt,
}: {
  client?: ProvisionClient;
  /** POST the captured token to the right server; throws on failure. */
  submitToken: (token: string) => Promise<void>;
  onError: (message: string) => void;
  onAttempt?: () => void;
}) {
  const [phase, setPhase] = useState<"idle" | "starting" | "code" | "verifying">("idle");
  const [authUrl, setAuthUrl] = useState<string | undefined>();
  const [code, setCode] = useState("");
  const [manualToken, setManualToken] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const submitRef = useRef(submitToken);
  submitRef.current = submitToken;
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const authActiveRef = useRef(false);

  useEffect(() => () => {
    if (authActiveRef.current && client) void client.cancelClaudeAuth();
  }, [client]);

  // Watch the CLI output while a sign-in is underway ("code": waiting on the
  // browser or a pasted code; "verifying": code submitted). The localhost
  // callback completes without a code, so this poll finishes both variants.
  useEffect(() => {
    if (!client || (phase !== "code" && phase !== "verifying")) return;
    let done = false;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const r = await client.pollClaudeAuth();
          if (done) return;
          if (r.token) {
            done = true;
            authActiveRef.current = false;
            clearInterval(timer);
            setPhase("verifying");
            try {
              await submitRef.current(r.token);
            } catch (e) {
              setPhase("idle");
              errorRef.current(e instanceof Error ? e.message : String(e));
            }
          } else if (r.exited) {
            done = true;
            authActiveRef.current = false;
            clearInterval(timer);
            setPhase("idle");
            errorRef.current(
              r.detail
                ? `Claude sign-in ended without a token. CLI output: ${r.detail}`
                : "Claude sign-in ended without a token. Try again.",
            );
          }
        } catch {
          // transient poll error — keep trying until phase changes
        }
      })();
    }, 1200);
    return () => {
      done = true;
      clearInterval(timer);
    };
  }, [phase, client]);

  const start = async () => {
    if (!client) return;
    onAttempt?.();
    setPhase("starting");
    try {
      authActiveRef.current = true;
      const { url } = await client.startClaudeAuth();
      setAuthUrl(url);
      setPhase("code");
    } catch (e) {
      authActiveRef.current = false;
      setPhase("idle");
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  const complete = async () => {
    if (!client) return;
    onAttempt?.();
    setPhase("verifying");
    try {
      await client.completeClaudeAuth(code.trim());
      // The poll picks the token out of the CLI output from here.
    } catch (e) {
      setPhase("code");
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  const cancel = () => {
    authActiveRef.current = false;
    if (client) void client.cancelClaudeAuth();
    setCode("");
    setPhase("idle");
  };

  const submitManual = async () => {
    onAttempt?.();
    setManualBusy(true);
    try {
      await submitToken(manualToken.trim());
      setManualToken("");
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setManualBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {client && phase === "idle" && (
        <Button size="sm" onClick={() => void start()}>
          Sign in with Claude
        </Button>
      )}
      {phase === "starting" && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="h-3.5 w-3.5" /> Opening your browser…
        </div>
      )}
      {(phase === "code" || phase === "verifying") && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Sign in in the browser — this usually completes automatically. If the browser shows a
            code instead, paste it here:
            {authUrl && (
              <>
                {" "}
                <a href={authUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                  open the page again <ExternalLink className="h-3 w-3" />
                </a>
              </>
            )}
          </p>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Paste the authorization code"
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 rounded border border-border/50 bg-background px-2 py-1 font-mono text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter" && code.trim() && phase === "code") void complete();
              }}
            />
            <Button size="sm" disabled={!code.trim() || phase === "verifying"} onClick={() => void complete()}>
              {phase === "verifying" ? "Verifying…" : "Confirm"}
            </Button>
            <Button size="sm" variant="ghost" onClick={cancel} disabled={phase === "verifying"}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {phase === "idle" && (
        <details className="text-xs text-muted-foreground" open={!client}>
          <summary className={cn("cursor-pointer", !client && "hidden")}>Or do it manually in a terminal</summary>
          <div className={cn("space-y-2", client && "mt-2")}>
            <p>Run this command, sign in, then paste the token it prints (sk-ant-oat01-…):</p>
            <ClaudeTokenCommand />
            <div className="flex gap-2">
              <input
                type="password"
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                placeholder="sk-ant-oat01-…"
                className="min-w-0 flex-1 rounded border border-border/50 bg-background px-2 py-1 font-mono text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={manualBusy || !manualToken.trim().startsWith("sk-ant-oat01-")}
                onClick={() => void submitManual()}
              >
                Submit
              </Button>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}

/** Per-tool run state so GitHub / Claude / Codex actions run independently. */
interface ToolRun {
  busy: boolean;
  op: SetupOperation | null;
  error: SetupError | null;
}

const IDLE_RUN: ToolRun = { busy: false, op: null, error: null };

function toSetupError(e: unknown): SetupError {
  const message = e instanceof Error ? e.message : String(e);
  return {
    state: "guided_setup",
    code: e instanceof SetupApiError && e.code ? e.code : "UNKNOWN",
    logExcerpt: message,
  };
}

/**
 * The GitHub / Claude / Codex install-and-sign-in cards. Used by the setup
 * wizard (explicit baseUrl for the fresh server) and by Settings > Connection
 * (no target: falls back to the stored server URL).
 */
export function ToolsPanel({
  client,
  baseUrl,
}: {
  client?: ProvisionClient;
  baseUrl?: string;
}) {
  const resolvedClient = useMemo(
    () => client ?? (isTauri() ? createProvisionClient() : undefined),
    [client],
  );
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [statusError, setStatusError] = useState<SetupError | null>(null);
  const [runs, setRuns] = useState<Record<string, ToolRun>>({});
  const [claudeDone, setClaudeDone] = useState(false);
  const abortControllers = useRef(new Set<AbortController>());

  const setupApi = useMemo(() => createSetupApi({ baseUrl }), [baseUrl]);

  const patchRun = useCallback((tool: string, patch: Partial<ToolRun>) => {
    setRuns((r) => ({ ...r, [tool]: { ...IDLE_RUN, ...r[tool], ...patch } }));
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await setupApi.getStatus());
      setStatusError(null);
    } catch (e) {
      setStatusError(toSetupError(e));
    }
  }, [setupApi]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => () => {
    for (const controller of abortControllers.current) controller.abort();
    abortControllers.current.clear();
  }, []);

  /** Run backend setup steps for one tool; other tools stay usable. */
  const runSteps = async (tool: string, steps: string[]) => {
    const controller = new AbortController();
    abortControllers.current.add(controller);
    patchRun(tool, { busy: true, op: null, error: null });
    try {
      const { operationId } = await setupApi.run({ steps });
      const op = await pollOperation(operationId, (o) => patchRun(tool, { op: o }), {
        api: setupApi,
        signal: controller.signal,
      });
      if (op.status === "failed") {
        const failed = op.steps.find((s) => s.status === "failed");
        patchRun(tool, {
          error: {
            state: "guided_setup",
            code: failed?.error?.code ?? "UNKNOWN",
            logExcerpt: failed?.error?.detail ?? failed?.error?.message,
          },
        });
      } else {
        // A provider may have been installed or signed in: the next model
        // selector must refetch the catalog instead of serving the stale cache.
        invalidateModelCatalog();
      }
      await refreshStatus();
    } catch (e) {
      if (!controller.signal.aborted) patchRun(tool, { error: toSetupError(e) });
    } finally {
      abortControllers.current.delete(controller);
      if (!controller.signal.aborted) patchRun(tool, { busy: false, op: null });
    }
  };

  const submitClaudeToken = async (token: string) => {
    await setupApi.submitClaudeToken(token);
    setClaudeDone(true);
    invalidateModelCatalog();
    await refreshStatus();
  };

  const gh = status?.detected.gh;
  const claude = status?.detected.claude;
  const codex = status?.detected.codex;
  const claudeAuthed = claude?.authenticated === true || claudeDone;
  const ghRun = runs.gh ?? IDLE_RUN;
  const claudeRun = runs.claude ?? IDLE_RUN;
  const codexRun = runs.codex ?? IDLE_RUN;

  if (status === null) {
    return statusError ? (
      <ErrorPanel
        error={statusError}
        onRetry={() => {
          setStatusError(null);
          void refreshStatus();
        }}
      />
    ) : (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" /> Detecting tools…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border/50 bg-card/50 p-4">
        <h2 className="mb-1 text-sm font-medium text-foreground">GitHub</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Sign in so Hive can clone your repositories and open pull requests.
        </p>
        {gh?.authenticated === true ? (
          <Connected label="GitHub" />
        ) : gh?.installed === false ? (
          <p className="text-xs text-destructive">
            GitHub CLI is missing. Install it on this server, then refresh this page.
          </p>
        ) : (
          <Button
            size="sm"
            disabled={ghRun.busy}
            onClick={() =>
              void runSteps("gh", ["auth_gh"])
            }
          >
            {ghRun.busy ? "Waiting for GitHub…" : "Sign in to GitHub"}
          </Button>
        )}
        {ghRun.op && <OperationActions op={ghRun.op} />}
        {ghRun.error && (
          <div className="mt-3">
            <ErrorPanel error={ghRun.error} onRetry={() => void runSteps("gh", ["auth_gh"])} />
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border/50 bg-card/50 p-4">
        <h2 className="mb-1 text-sm font-medium text-foreground">Claude</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Install Claude Code on the server and sign in with your Claude subscription.
        </p>
        {claudeAuthed ? (
          <Connected label="Claude" />
        ) : !claude?.installed ? (
          <Button
            size="sm"
            disabled={claudeRun.busy}
            onClick={() => void runSteps("claude", ["install_claude"])}
          >
            {claudeRun.busy ? "Installing…" : "Install Claude"}
          </Button>
        ) : (
          <ClaudeSignIn
            client={resolvedClient}
            submitToken={submitClaudeToken}
            onAttempt={() => patchRun("claude", { error: null })}
            onError={(message) =>
              patchRun("claude", {
                error: { state: "guided_setup", code: "CLAUDE_PASTEBACK_BROKEN", logExcerpt: message },
              })
            }
          />
        )}
        {claudeRun.error && (
          <div className="mt-3">
            <ErrorPanel
              error={claudeRun.error}
              onDismiss={() => patchRun("claude", { error: null })}
            />
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border/50 bg-card/50 p-4">
        <h2 className="mb-1 text-sm font-medium text-foreground">Codex</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Install Codex on the server and sign in with your ChatGPT account.
        </p>
        {codex?.installed && codex.authenticated === true ? (
          <Connected label="Codex" />
        ) : !codex?.installed ? (
          <Button
            size="sm"
            disabled={codexRun.busy}
            onClick={() => void runSteps("codex", ["install_codex"])}
          >
            {codexRun.busy ? "Installing…" : "Install Codex"}
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={codexRun.busy}
            onClick={() => void runSteps("codex", ["auth_codex"])}
          >
            {codexRun.busy ? "Waiting for sign-in…" : "Sign in to Codex"}
          </Button>
        )}
        {codexRun.op && <OperationActions op={codexRun.op} />}
        {codexRun.error && (
          <div className="mt-3">
            <ErrorPanel
              error={codexRun.error}
              onRetry={() =>
                void runSteps("codex", codex?.installed ? ["auth_codex"] : ["install_codex"])
              }
            />
          </div>
        )}
      </section>
    </div>
  );
}
