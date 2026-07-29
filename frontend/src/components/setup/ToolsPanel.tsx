import { useState, type FormEvent } from "react";
import { ArrowUpCircle, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import {
  TOOL_AUTH_FAILURE_HINTS,
  TOOL_FAILURE_HINTS,
  type SetupToolId,
  type ToolAuthSession,
  type ToolOperation,
  type ToolOperationKind,
  type ToolStatus,
} from "@hive/shared/setup-types";
import { Button } from "@/components/ui/button";
import { ProviderIcon } from "@/components/chat/ProviderIcon";
import { DeviceCodeRow } from "@/components/setup/DeviceCodeRow";
import { ErrorPanel } from "@/components/setup/ErrorPanel";
import { SetupCard } from "@/components/setup/SetupCard";
import { TOOL_PROVIDERS, useSetupTools } from "@/components/setup/useSetupTools";
import { openExternal } from "@/lib/open-external";
import type { SetupApiTarget } from "@/lib/setup-api";
import { cn } from "@/lib/utils";

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
  const {
    harnesses,
    operationFor,
    authSessionFor,
    actionError,
    isPending,
    isError,
    error,
    start,
    startAuth,
    submitCode,
    cancelAuth,
  } = useSetupTools(target);

  if (isPending) {
    return (
      <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
        <Loader2 className="h-4 w-4 animate-spin" />
        Detecting tools…
      </div>
    );
  }

  if (isError) {
    return (
      <p className={cn("text-xs text-destructive", className)}>
        Could not read tool status
        {error instanceof Error ? `: ${error.message}` : "."}
      </p>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {harnesses.map((tool) => (
        <ToolCard
          key={tool.id}
          tool={tool}
          operation={operationFor(tool.id)}
          pending={start.isPending && start.variables?.tool === tool.id}
          onRun={(kind) => start.mutate({ tool: tool.id, kind })}
          authSession={authSessionFor(tool.id)}
          actionError={actionError[tool.id]}
          authPending={startAuth.isPending && startAuth.variables === tool.id}
          codePending={submitCode.isPending && submitCode.variables?.tool === tool.id}
          onConnect={() => startAuth.mutate(tool.id)}
          onSubmitCode={(code) => submitCode.mutate({ tool: tool.id, code })}
          onCancelAuth={() => cancelAuth.mutate(tool.id)}
        />
      ))}
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
    <SetupCard
      className={!tool.installed && !busy ? "opacity-70" : undefined}
      title={tool.label}
      titleAdornment={
        providers && (
          <span className="inline-flex items-center gap-1">
            {providers.map((provider) => (
              <span key={provider.id} title={`Runs ${provider.label} sessions`}>
                <ProviderIcon provider={provider.id} colored className="size-3" />
              </span>
            ))}
          </span>
        )
      }
      status={
        <>
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
        </>
      }
      actions={
        <>
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
        </>
      }
    >
      {prompt &&
        (prompt.needsCode ? (
          <div className="mt-3">
            <CodeForm
              key={authSession?.startedAt}
              inputLabel={`Paste the code ${tool.label} asked for`}
              submitting={codePending}
              onSubmit={onSubmitCode}
              onOpen={() => void openExternal(prompt.verificationUri)}
            />
          </div>
        ) : (
          <DeviceCodeRow verificationUri={prompt.verificationUri} userCode={prompt.userCode} />
        ))}

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
    </SetupCard>
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
