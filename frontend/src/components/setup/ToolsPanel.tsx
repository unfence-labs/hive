import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpCircle,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  isToolAuthTerminal,
  TOOL_AUTH_FAILURE_HINTS,
  TOOL_FAILURE_HINTS,
  type SetupToolId,
  type ToolAuthSession,
  type ToolOperation,
  type ToolOperationKind,
  type ToolStatus,
} from "@hive/shared/setup-types";
import { Button } from "@/components/ui/button";
import { ProviderIcon, type KnownProvider } from "@/components/chat/ProviderIcon";
import { useClipboardCopy } from "@/hooks/useClipboardCopy";
import { openExternal } from "@/lib/open-external";
import { createSetupApi, type SetupApiTarget } from "@/lib/setup-api";
import { refreshModelCatalog } from "@/hooks/useModels";
import { cn } from "@/lib/utils";

/** How often a running operation is re-read. Installs take minutes, not ms. */
const POLL_INTERVAL_MS = 2_000;

/**
 * Model providers each harness serves (the Claude CLI also runs Kimi sessions).
 * Also the definition of what this panel renders: the server reports gh too,
 * but gh is not an agent harness — its account lives in Settings → Account.
 */
const TOOL_PROVIDERS: Partial<Record<SetupToolId, { id: KnownProvider; label: string }[]>> = {
  claude: [
    { id: "claude", label: "Claude" },
    { id: "kimi", label: "Kimi" },
  ],
  codex: [{ id: "codex", label: "Codex" }],
};

const PHASE_LABELS: Record<ToolOperation["phase"], string> = {
  detecting: "Checking current version…",
  running: "Downloading and installing…",
  verifying: "Verifying the install…",
  done: "Finishing…",
};

/** The account being connected, which is not always what the tool is called. */
const CONNECT_LABELS: Partial<Record<SetupToolId, string>> = {
  claude: "Connect Claude",
  codex: "Connect Codex",
};


/**
 * Tool state with install and update actions.
 *
 * Deliberately container-agnostic: no page header, no navigation, no fixed
 * width. Settings renders it inside its own frame today and the installer's
 * final screen renders the same component tomorrow, so anything that assumed
 * a Settings layout would have to be undone there.
 *
 * Nothing here is written to browser storage. Operation state lives on the
 * server — which is what lets it survive this component unmounting — and the
 * command output it renders is diagnostic text that has no business being
 * persisted in a browser.
 */
export function ToolsPanel({
  target,
  className,
}: {
  target?: SetupApiTarget;
  className?: string;
}) {
  const api = useMemo(() => createSetupApi(target), [target]);
  const scope = target?.baseUrl ?? "default";
  const toolsKey = useMemo(() => ["setup", "tools", scope] as const, [scope]);
  const statusKey = useMemo(() => ["setup", "status", scope] as const, [scope]);
  const queryClient = useQueryClient();

  const { data, isPending, isError, error } = useQuery({
    queryKey: toolsKey,
    queryFn: ({ signal }) => api.getTools(signal),
  });

  // The server is the source of truth for progress, so poll while something
  // is running and stop the moment nothing is. Progress is read from the
  // cheap in-memory status endpoint: watching a long install must not re-run
  // the full tool detection every tick.
  const { data: status } = useQuery({
    queryKey: statusKey,
    queryFn: ({ signal }) => api.getStatus(signal),
    refetchInterval: (query) => {
      // Optional-chained throughout: this body comes off the wire, and a
      // server that answers with something else must not crash the panel.
      const state = query.state.data;
      const busy =
        state?.operations?.some((op) => op.status === "running") ||
        state?.authSessions?.some((session) => !isToolAuthTerminal(session.state));
      return busy ? POLL_INTERVAL_MS : false;
    },
  });

  // The status query is fresher — every mutation invalidates it — but the
  // first tools response may land before it, so fall back rather than flicker.
  const operations = useMemo(
    () => status?.operations ?? data?.operations ?? [],
    [status, data],
  );
  const authSessions = useMemo(
    () => status?.authSessions ?? data?.authSessions ?? [],
    [status, data],
  );

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: statusKey });
  };

  // One client-side error slot per tool, whatever the action that failed —
  // requests that never became server-side state have nowhere else to show.
  const [actionError, setActionError] = useState<Partial<Record<SetupToolId, string>>>({});
  const setError = (tool: SetupToolId, message: string | undefined): void =>
    setActionError((current) => ({ ...current, [tool]: message }));

  const start = useMutation({
    mutationFn: ({ tool, kind }: { tool: SetupToolId; kind: ToolOperationKind }) =>
      api.startOperation(tool, kind),
    // Any action clears what an earlier one left on screen.
    onMutate: ({ tool }) => setError(tool, undefined),
    onError: (err, { tool, kind }) =>
      setError(tool, err instanceof Error ? err.message : `Could not start the ${kind}.`),
    // Fire-and-forget on purpose: returning the invalidation promise would
    // hold `isPending` — and the disabled button — through the status
    // refetch's retry cycle, seconds against a server that is down.
    onSettled: invalidate,
  });

  const startAuth = useMutation({
    mutationFn: (tool: SetupToolId) => api.startAuth(tool),
    onMutate: (tool) => setError(tool, undefined),
    onError: (err, tool) =>
      setError(tool, err instanceof Error ? err.message : "Could not start sign-in."),
    onSettled: invalidate,
  });

  const submitCode = useMutation({
    mutationFn: ({ tool, code }: { tool: SetupToolId; code: string }) =>
      api.submitAuthCode(tool, code),
    onMutate: ({ tool }) => setError(tool, undefined),
    onError: (err, { tool }) =>
      setError(tool, err instanceof Error ? err.message : "That code was not accepted."),
    onSettled: invalidate,
  });

  const cancelAuth = useMutation({
    mutationFn: (tool: SetupToolId) => api.cancelAuth(tool),
    onSettled: invalidate,
  });

  // Watch live work so its completion is acted on exactly once: the cheap
  // status poll cannot see versions or auth flags, so the full tools list is
  // re-read; and a harness that just landed must not stay hidden behind the
  // catalog the model picker cached before it existed. The trigger is the
  // live → terminal transition, not the mutation resolving: the mutation only
  // reports that the work *started*, and refreshing then would read the state
  // the work is about to change.
  const watched = useRef(new Set<string>());
  useEffect(() => {
    let finished = false;
    for (const operation of operations) {
      if (operation.status === "running") {
        watched.current.add(operation.id);
      } else if (watched.current.delete(operation.id)) {
        finished = true;
        if (operation.status === "succeeded") void refreshModelCatalog();
      }
    }
    for (const session of authSessions) {
      const key = `${session.tool}:${session.startedAt}`;
      if (!isToolAuthTerminal(session.state)) {
        watched.current.add(key);
      } else if (watched.current.delete(key)) {
        finished = true;
      }
    }
    if (finished) void queryClient.invalidateQueries({ queryKey: toolsKey });
  }, [operations, authSessions, queryClient, toolsKey]);

  const operationFor = (tool: SetupToolId): ToolOperation | undefined =>
    operations.find((op) => op.tool === tool);

  if (isPending) {
    return (
      <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
        <Loader2 className="h-4 w-4 animate-spin" />
        Detecting tools…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p className={cn("text-xs text-destructive", className)}>
        Could not read tool status
        {error instanceof Error ? `: ${error.message}` : "."}
      </p>
    );
  }

  // Same wire-tolerance as the poll above: render nothing over a body that
  // lacks the list rather than crash the page that contains the panel.
  const tools = (data.tools ?? []).filter((tool) => TOOL_PROVIDERS[tool.id] !== undefined);
  const anyAgentConnected = tools.some((tool) => tool.authenticated);

  return (
    <div className={cn("space-y-4", className)}>
      {tools.map((tool) => (
        <ToolCard
          key={tool.id}
          tool={tool}
          operation={operationFor(tool.id)}
          pending={start.isPending && start.variables?.tool === tool.id}
          onRun={(kind) => start.mutate({ tool: tool.id, kind })}
          authSession={authSessions.find((session) => session.tool === tool.id)}
          actionError={actionError[tool.id]}
          authPending={startAuth.isPending && startAuth.variables === tool.id}
          codePending={submitCode.isPending && submitCode.variables?.tool === tool.id}
          onConnect={() => startAuth.mutate(tool.id)}
          onSubmitCode={(code) => submitCode.mutate({ tool: tool.id, code })}
          onCancelAuth={() => cancelAuth.mutate(tool.id)}
        />
      ))}

      {/*
        Hive runs a session on whichever harness is connected, so this is a
        statement of what works, never a gate. Nothing above is disabled for
        want of the other one.
      */}
      <p className="text-xs text-muted-foreground">
        {anyAgentConnected
          ? "One agent harness is enough — connecting the other adds its models, it is not required."
          : "Connect Claude Code or Codex to run sessions. Either one on its own is enough."}
      </p>

    </div>
  );
}

function ToolCard({
  tool,
  operation,
  pending,
  onRun,
  authSession,
  actionError,
  authPending,
  codePending,
  onConnect,
  onSubmitCode,
  onCancelAuth,
}: {
  tool: ToolStatus;
  operation?: ToolOperation;
  pending: boolean;
  onRun: (kind: ToolOperationKind) => void;
  authSession?: ToolAuthSession;
  actionError?: string;
  authPending: boolean;
  codePending: boolean;
  onConnect: () => void;
  onSubmitCode: (code: string) => void;
  onCancelAuth: () => void;
}) {
  const running = operation?.status === "running";
  const busy = running || pending;
  const providers = TOOL_PROVIDERS[tool.id];

  const prompt =
    authSession &&
    (authSession.state === "awaiting_authorization" ||
      authSession.state === "awaiting_code")
      ? {
          verificationUri: authSession.verificationUri ?? "",
          userCode: authSession.userCode,
          needsCode: authSession.needsCode,
        }
      : undefined;

  const signingIn =
    authPending ||
    (authSession !== undefined &&
      (authSession.state === "starting" || authSession.state === "verifying"));

  // Failures already acted on. Server-side failure records linger until their
  // session or operation is replaced; starting anything hides them at once.
  const [dismissed, setDismissed] = useState<string[]>([]);
  const act = (action: () => void) => () => {
    setDismissed((current) => [
      ...current,
      ...(operation?.status === "failed" ? [operation.id] : []),
      ...(authSession ? [authSession.startedAt] : []),
    ]);
    action();
  };

  // What went wrong with the sign-in, whatever the shape it arrived in. A
  // cancelled sign-in says nothing: the operator did the cancelling.
  const sessionProblem = ((): { title: string; detail?: string; output?: string } | undefined => {
    if (!authSession || dismissed.includes(authSession.startedAt)) return undefined;
    if (authSession.state === "failed" && authSession.failure) {
      return {
        title: `${tool.label} sign-in failed`,
        detail: `${authSession.failure.message} ${TOOL_AUTH_FAILURE_HINTS[authSession.failure.reason]}`,
        output: authSession.failure.outputExcerpt,
      };
    }
    if (authSession.state === "expired") {
      return {
        title: `${tool.label} sign-in expired`,
        detail: "The sign-in code expired before it was confirmed. Start again.",
      };
    }
    if (authSession.notice) return { title: authSession.notice };
    return undefined;
  })();
  const problem = actionError !== undefined ? { title: actionError } : sessionProblem;

  const failedOperation =
    operation?.status === "failed" && operation.failure && !dismissed.includes(operation.id)
      ? operation
      : undefined;

  return (
    <section
      className={cn(
        "rounded-lg border border-border/50 bg-card/50 px-4 py-3",
        !tool.installed && !busy && "opacity-70",
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-foreground">{tool.label}</h3>
            {providers && (
              <span className="inline-flex items-center gap-1">
                {providers.map((provider) => (
                  <span key={provider.id} title={`Runs ${provider.label} sessions`}>
                    <ProviderIcon provider={provider.id} colored className="size-3" />
                  </span>
                ))}
              </span>
            )}
          </div>
          <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">
              {tool.installed ? `v${tool.version ?? "unknown"}` : "not installed"}
            </span>
            {tool.installed && (
              <>
                <span className="text-border">·</span>
                {prompt ? (
                  // The sign-in under way takes the status slot.
                  <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5">
                    Waiting for authorization…
                    <Loader2 className="h-3 w-3 animate-spin" />
                  </span>
                ) : (
                  <>
                    <AuthLabel authenticated={tool.authenticated} />
                    {tool.authenticated && (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        className="-ml-1 text-muted-foreground"
                        disabled={busy || signingIn}
                        onClick={act(onConnect)}
                        aria-label="Sign in again"
                        title="Sign in again — switches the connected account"
                      >
                        {signingIn ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3 w-3" />
                        )}
                      </Button>
                    )}
                  </>
                )}
              </>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {running && operation && (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {PHASE_LABELS[operation.phase]}
            </span>
          )}
          {/* A sign-in under way owns the action cluster: Cancel alone, the
              update offer comes back once the sign-in is settled. */}
          {!prompt && tool.updateAvailable && tool.latestVersion && (
            <span className="inline-flex items-center gap-1 rounded-full border border-warning-border bg-warning-muted px-2 py-0.5 text-[11px] font-medium text-warning-foreground">
              <ArrowUpCircle className="h-3 w-3" />v{tool.latestVersion}
            </span>
          )}
          {!prompt && (!tool.installed || tool.updateAvailable) && (
            <Button
              size="sm"
              variant={tool.installed ? "outline" : "default"}
              disabled={busy}
              onClick={act(() => onRun(tool.installed ? "update" : "install"))}
            >
              {tool.installed ? "Update" : "Install"}
            </Button>
          )}
          {tool.installed && !prompt && !tool.authenticated && (
            <Button size="sm" disabled={busy || signingIn} onClick={act(onConnect)}>
              {signingIn && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              {CONNECT_LABELS[tool.id]}
            </Button>
          )}
          {/* The one way out of a sign-in under way. A sign-in has no deadline
              of Hive's making, so a stalled one must not need a backend
              restart to escape. */}
          {prompt && (
            <Button size="sm" variant="ghost" onClick={onCancelAuth}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      {prompt && (
        <div className="mt-3 space-y-2">
          {prompt.needsCode ? (
            <CodeForm
              key={authSession?.startedAt}
              inputLabel={`Paste the code ${tool.label} asked for`}
              submitting={codePending}
              onSubmit={onSubmitCode}
              onOpen={() => void openExternal(prompt.verificationUri)}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {prompt.userCode && <CodeChip code={prompt.userCode} />}
              <Button
                size="sm"
                className="ml-auto"
                onClick={() => void openExternal(prompt.verificationUri)}
              >
                Open sign-in page
                <ExternalLink className="ml-1.5 h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
      )}

      {problem && (
        <ErrorPanel
          title={problem.title}
          detail={problem.detail}
          output={problem.output}
        />
      )}

      {failedOperation?.failure && (
        <ErrorPanel
          title={`${tool.label} ${failedOperation.kind} failed`}
          detail={TOOL_FAILURE_HINTS[failedOperation.failure.reason]}
          output={failedOperation.failure.outputExcerpt}
        />
      )}
    </section>
  );
}

/** The one shape every problem here is reported in: what failed, why, and the
 * command output when there is some. */
function ErrorPanel({
  title,
  detail,
  output,
}: {
  title: string;
  detail?: string;
  output?: string;
}) {
  return (
    <div role="alert" className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
      <p className="flex items-center gap-2 text-xs font-medium text-destructive">
        <AlertTriangle className="h-3.5 w-3.5" />
        {title}
      </p>
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
      {output && (
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-2 font-mono text-[11px] text-muted-foreground">
          {output}
        </pre>
      )}
    </div>
  );
}

/** The device code, copied by clicking it. */
function CodeChip({ code }: { code: string }) {
  const { copy, isCopied } = useClipboardCopy();
  return (
    <button
      type="button"
      onClick={() => void copy(code)}
      aria-label={isCopied(code) ? "Code copied" : "Copy code to clipboard"}
      className="group inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <code className="font-mono text-sm font-bold tracking-widest">{code}</code>
      {isCopied(code) ? (
        <Check className="h-3.5 w-3.5 text-success-foreground" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
      )}
    </button>
  );
}

/** Own component so each auth session starts with an empty paste box. */
function CodeForm({
  inputLabel,
  submitting,
  onSubmit,
  onOpen,
}: {
  inputLabel: string;
  submitting: boolean;
  onSubmit: (code: string) => void;
  onOpen: () => void;
}) {
  const [pasted, setPasted] = useState("");
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const trimmed = pasted.trim();
    if (trimmed) onSubmit(trimmed);
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <input
        aria-label={inputLabel}
        value={pasted}
        onChange={(event) => setPasted(event.target.value)}
        placeholder={inputLabel}
        autoComplete="off"
        spellCheck={false}
        className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <Button size="sm" type="submit" variant="outline" disabled={!pasted.trim() || submitting}>
        {submitting && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
        Finish
      </Button>
      <Button size="sm" type="button" onClick={onOpen}>
        Open sign-in page
        <ExternalLink className="ml-1.5 h-3 w-3" />
      </Button>
    </form>
  );
}

function AuthLabel({ authenticated }: { authenticated: boolean }) {
  // The unauthenticated label inherits the line's muted color.
  return authenticated ? (
    <span className="text-success-foreground">Signed in</span>
  ) : (
    <span>Not signed in</span>
  );
}
