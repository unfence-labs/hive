import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpCircle,
  CheckCircle2,
  CircleSlash,
  Loader2,
  LogIn,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ProviderIcon, type KnownProvider } from "@/components/chat/ProviderIcon";
import { SignInPrompt } from "@/components/setup/SignInPrompt";
import { ApiError } from "@/hooks/useApi";
import {
  createSetupApi,
  CONFIRM_REQUIRED_STATUS,
  type SetupApiTarget,
} from "@/lib/setup-api";
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

const TOOL_BLURBS: Partial<Record<SetupToolId, string>> = {
  claude: "Runs Claude and Kimi sessions on this server.",
  codex: "Runs Codex sessions on this server.",
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

/** How a sign-in that did not connect is explained, without a failure behind it. */
const AUTH_OUTCOME_MESSAGES: Partial<Record<ToolAuthSession["state"], string>> = {
  expired: "The sign-in code expired before it was confirmed. Start again.",
  cancelled: "Sign-in cancelled.",
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

  const start = useMutation({
    mutationFn: ({ tool, kind }: { tool: SetupToolId; kind: ToolOperationKind }) =>
      api.startOperation(tool, kind),
    onSettled: () => queryClient.invalidateQueries({ queryKey: statusKey }),
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: statusKey });
  };

  const [authError, setAuthError] = useState<Partial<Record<SetupToolId, string>>>({});
  const setError = (tool: SetupToolId, message: string | undefined): void =>
    setAuthError((current) => ({ ...current, [tool]: message }));

  // A refusal to sign the server out of a working tool is a question, not an
  // error: hold it until the operator answers, then retry with the answer.
  const [confirm, setConfirm] = useState<{ tool: SetupToolId; message: string } | null>(
    null,
  );

  const startAuth = useMutation({
    mutationFn: ({ tool, force }: { tool: SetupToolId; force?: boolean }) =>
      api.startAuth(tool, { force }),
    onMutate: ({ tool }) => setError(tool, undefined),
    onError: (err, { tool }) => {
      if (err instanceof ApiError && err.status === CONFIRM_REQUIRED_STATUS) {
        setConfirm({ tool, message: err.message });
        return;
      }
      setError(tool, err instanceof Error ? err.message : "Could not start sign-in.");
    },
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
          authError={authError[tool.id]}
          authPending={startAuth.isPending && startAuth.variables?.tool === tool.id}
          codePending={submitCode.isPending && submitCode.variables?.tool === tool.id}
          onConnect={() => startAuth.mutate({ tool: tool.id })}
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

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent className="bg-popover">
          <AlertDialogHeader>
            <AlertDialogTitle>Sign in again?</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm) startAuth.mutate({ tool: confirm.tool, force: true });
                setConfirm(null);
              }}
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ToolCard({
  tool,
  operation,
  pending,
  onRun,
  authSession,
  authError,
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
  authError?: string;
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

  const problem =
    authError ??
    (authSession?.state === "failed" && authSession.failure
      ? `${authSession.failure.message} ${TOOL_AUTH_FAILURE_HINTS[authSession.failure.reason]}`
      : undefined) ??
    (authSession && AUTH_OUTCOME_MESSAGES[authSession.state]);

  return (
    <section
      className={cn(
        "rounded-lg border border-border/50 bg-card/50 p-5",
        !tool.installed && !busy && "opacity-70",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-foreground">{tool.label}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{TOOL_BLURBS[tool.id]}</p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {tool.installed ? `v${tool.version ?? "unknown"}` : "not installed"}
            {tool.updateAvailable && tool.latestVersion ? ` → v${tool.latestVersion}` : ""}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <StatusBadge tool={tool} />
          {tool.installed && <AuthBadge authenticated={tool.authenticated} />}
          {providers && (
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {providers.map((provider) => (
                <span
                  key={provider.id}
                  title={`Runs ${provider.label} sessions`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                >
                  <ProviderIcon provider={provider.id} colored className="size-3" />
                  {provider.label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button
          size="sm"
          variant={tool.installed ? "outline" : "default"}
          disabled={busy || (tool.installed && !tool.updateAvailable)}
          onClick={() => onRun(tool.installed ? "update" : "install")}
        >
          {tool.installed ? "Update" : "Install"}
        </Button>

        {tool.installed && !prompt && (
          <>
            <Button
              size="sm"
              variant={tool.authenticated ? "ghost" : "default"}
              disabled={busy || signingIn}
              onClick={onConnect}
            >
              {signingIn && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              {tool.authenticated ? "Sign in again" : CONNECT_LABELS[tool.id]}
            </Button>
            {/* A sign-in has no deadline of Hive's making, so a stalled one
                needs a way out that is not restarting the backend. */}
            {signingIn && (
              <Button size="sm" variant="ghost" onClick={onCancelAuth}>
                Cancel
              </Button>
            )}
          </>
        )}

        {running && operation && (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {PHASE_LABELS[operation.phase]}
          </span>
        )}
      </div>

      {prompt && (
        <SignInPrompt
          inputId={`sign-in-code-${tool.id}`}
          verificationUri={prompt.verificationUri}
          userCode={prompt.userCode}
          onSubmitCode={prompt.needsCode ? onSubmitCode : undefined}
          codeLabel={`Paste the code ${tool.label} asked for`}
          submitting={codePending}
          onCancel={onCancelAuth}
          error={authError ?? authSession?.notice}
        />
      )}

      {!prompt && problem && (
        <p className="mt-3 text-xs text-destructive" role="alert">
          {problem}
        </p>
      )}

      {!prompt && authSession?.state === "failed" && authSession.failure?.outputExcerpt && (
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-2 font-mono text-[11px] text-muted-foreground">
          {authSession.failure.outputExcerpt}
        </pre>
      )}

      {operation?.status === "failed" && operation.failure && (
        <FailurePanel failure={operation.failure} kind={operation.kind} label={tool.label} />
      )}
    </section>
  );
}

function FailurePanel({
  failure,
  kind,
  label,
}: {
  failure: NonNullable<ToolOperation["failure"]>;
  kind: ToolOperationKind;
  label: string;
}) {
  return (
    <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
      <p className="flex items-center gap-2 text-xs font-medium text-destructive">
        <AlertTriangle className="h-3.5 w-3.5" />
        {label} {kind} failed
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{TOOL_FAILURE_HINTS[failure.reason]}</p>
      {failure.outputExcerpt && (
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-2 font-mono text-[11px] text-muted-foreground">
          {failure.outputExcerpt}
        </pre>
      )}
    </div>
  );
}

const PILL =
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium";
const NEUTRAL_PILL = `${PILL} border-border bg-muted/50 text-muted-foreground`;

function StatusBadge({ tool }: { tool: ToolStatus }) {
  if (!tool.installed) {
    return (
      <span className={NEUTRAL_PILL}>
        <CircleSlash className="h-3 w-3" />
        Not installed
      </span>
    );
  }

  if (tool.updateAvailable) {
    return (
      <span
        className={cn(PILL, "border-warning-border bg-warning-muted text-warning-foreground")}
      >
        <ArrowUpCircle className="h-3 w-3" />
        Update available
      </span>
    );
  }

  // Installed, but the registry could not be reached to compare — say so
  // rather than claiming it is current on evidence we do not have.
  if (tool.latestVersion == null) {
    return <span className={NEUTRAL_PILL}>Installed</span>;
  }

  return (
    <span
      className={cn(PILL, "border-success-border bg-success-muted text-success-foreground")}
    >
      <CheckCircle2 className="h-3 w-3" />
      Up to date
    </span>
  );
}

function AuthBadge({ authenticated }: { authenticated: boolean }) {
  return authenticated ? (
    <span className={cn(PILL, "border-transparent text-success-foreground")}>
      <CheckCircle2 className="h-3 w-3" />
      Signed in
    </span>
  ) : (
    <span className={cn(PILL, "border-transparent text-muted-foreground")}>
      <LogIn className="h-3 w-3" />
      Not signed in
    </span>
  );
}
