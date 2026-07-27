import { useEffect, useMemo, useRef } from "react";
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
  TOOL_FAILURE_HINTS,
  type SetupToolId,
  type ToolOperation,
  type ToolOperationKind,
  type ToolStatus,
} from "@hive/shared/setup-types";
import { Button } from "@/components/ui/button";
import { ProviderIcon, type KnownProvider } from "@/components/chat/ProviderIcon";
import { createSetupApi, type SetupApiTarget } from "@/lib/setup-api";
import { refreshModelCatalog } from "@/hooks/useModels";
import { cn } from "@/lib/utils";

/** How often a running operation is re-read. Installs take minutes, not ms. */
const POLL_INTERVAL_MS = 2_000;

/** Model providers each harness serves (the Claude CLI also runs Kimi sessions). */
const TOOL_PROVIDERS: Partial<Record<SetupToolId, { id: KnownProvider; label: string }[]>> = {
  claude: [
    { id: "claude", label: "Claude" },
    { id: "kimi", label: "Kimi" },
  ],
  codex: [{ id: "codex", label: "Codex" }],
};

const TOOL_BLURBS: Record<SetupToolId, string> = {
  claude: "Runs Claude and Kimi sessions on this server.",
  codex: "Runs Codex sessions on this server.",
  gh: "Lets Hive clone repositories and open pull requests.",
};

const PHASE_LABELS: Record<ToolOperation["phase"], string> = {
  detecting: "Checking current version…",
  running: "Downloading and installing…",
  verifying: "Verifying the install…",
  done: "Finishing…",
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
  const queryKey = useMemo(
    () => ["setup", "tools", target?.baseUrl ?? "default"] as const,
    [target?.baseUrl],
  );
  const queryClient = useQueryClient();

  const { data, isPending, isError, error } = useQuery({
    queryKey,
    queryFn: ({ signal }) => api.getTools(signal),
    // The server is the source of truth for progress, so poll while something
    // is running and stop the moment nothing is.
    refetchInterval: (query) =>
      query.state.data?.operations.some((op) => op.status === "running")
        ? POLL_INTERVAL_MS
        : false,
  });

  const start = useMutation({
    mutationFn: ({ tool, kind }: { tool: SetupToolId; kind: ToolOperationKind }) =>
      api.startOperation(tool, kind),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  // A harness that just landed must not stay hidden behind the catalog the
  // model picker cached before it existed. The trigger is the running →
  // succeeded transition, not the mutation resolving: the mutation only
  // reports that the install *started*, and refreshing then would read the
  // state the install is about to change.
  const watched = useRef(new Set<string>());
  useEffect(() => {
    for (const operation of data?.operations ?? []) {
      if (operation.status === "running") {
        watched.current.add(operation.id);
      } else if (operation.status === "succeeded" && watched.current.delete(operation.id)) {
        void refreshModelCatalog();
      }
    }
  }, [data]);

  const operationFor = (tool: SetupToolId): ToolOperation | undefined =>
    data?.operations.find((op) => op.tool === tool);

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

  return (
    <div className={cn("space-y-4", className)}>
      {data.tools.map((tool) => (
        <ToolCard
          key={tool.id}
          tool={tool}
          operation={operationFor(tool.id)}
          pending={start.isPending && start.variables?.tool === tool.id}
          onRun={(kind) => start.mutate({ tool: tool.id, kind })}
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
}: {
  tool: ToolStatus;
  operation?: ToolOperation;
  pending: boolean;
  onRun: (kind: ToolOperationKind) => void;
}) {
  const running = operation?.status === "running";
  const busy = running || pending;
  const providers = TOOL_PROVIDERS[tool.id];

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
        {tool.managed ? (
          <Button
            size="sm"
            variant={tool.installed ? "outline" : "default"}
            disabled={busy || (tool.installed && !tool.updateAvailable)}
            onClick={() => onRun(tool.installed ? "update" : "install")}
          >
            {tool.installed ? "Update" : "Install"}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            Installed by the Hive installer from a checksum-pinned release. Re-run the
            installer on the server to change it.
          </p>
        )}

        {running && operation && (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {PHASE_LABELS[operation.phase]}
          </span>
        )}
      </div>

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
  if (tool.managed && tool.latestVersion == null) {
    return <span className={NEUTRAL_PILL}>Installed</span>;
  }

  return (
    <span
      className={cn(PILL, "border-success-border bg-success-muted text-success-foreground")}
    >
      <CheckCircle2 className="h-3 w-3" />
      {tool.managed ? "Up to date" : "Installed"}
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
