import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  isToolAuthTerminal,
  type SetupToolId,
  type ToolAuthSession,
  type ToolOperation,
  type ToolOperationKind,
} from "@hive/shared/setup-types";
import type { KnownProvider } from "@/components/chat/ProviderIcon";
import { createSetupApi, type SetupApiTarget } from "@/lib/setup-api";
import { refreshModelCatalog } from "@/hooks/useModels";
import { PROVIDER_USAGE_QUERY_KEY } from "@/hooks/useProviderUsage";

/** How often a running operation is re-read. Installs take minutes, not ms. */
const POLL_INTERVAL_MS = 2_000;

/**
 * Model providers each harness serves (the Claude CLI also runs Kimi sessions).
 * Also the definition of what an agent harness is: the server reports gh too,
 * but gh is not an agent harness — its account lives in Settings → Account.
 */
export const TOOL_PROVIDERS: Partial<
  Record<SetupToolId, { id: KnownProvider; label: string }[]>
> = {
  claude: [
    { id: "claude", label: "Claude" },
    { id: "kimi", label: "Kimi" },
  ],
  codex: [{ id: "codex", label: "Codex" }],
};

/**
 * Live work whose completion has already been acted on, keyed by target scope.
 *
 * Module-scoped rather than a ref, because "operation X has finished and the
 * catalog was refreshed for it" is a fact about the server, not about one
 * mounted component. Two components calling this hook on the same target share
 * one set, so the first to observe a live → terminal transition consumes it and
 * the second sees nothing left to do — one catalog refresh, one refetch.
 */
const actedOn = new Map<string, Set<string>>();

/**
 * The setup data layer: tool state, live operations and sign-in flows, and the
 * actions that drive them.
 *
 * Split out of the panel so a second component can render the same state
 * without a second set of requests — React Query dedupes on the key, so both
 * consumers share one poll.
 */
export function useSetupTools(target?: SetupApiTarget) {
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
  useEffect(() => {
    let watched = actedOn.get(scope);
    if (!watched) {
      watched = new Set<string>();
      actedOn.set(scope, watched);
    }
    let finished = false;
    let catalogChanged = false;
    let providerUsageChanged = false;
    for (const operation of operations) {
      if (operation.status === "running") {
        watched.add(operation.id);
      } else if (watched.delete(operation.id)) {
        finished = true;
        if (operation.status === "succeeded") catalogChanged = true;
      }
    }
    for (const session of authSessions) {
      const key = `${session.tool}:${session.startedAt}`;
      if (!isToolAuthTerminal(session.state)) {
        watched.add(key);
      } else if (watched.delete(key)) {
        finished = true;
        if (session.state === "connected") {
          catalogChanged = true;
          if (TOOL_PROVIDERS[session.tool] !== undefined) {
            providerUsageChanged = true;
          }
        }
      }
    }
    if (catalogChanged) void refreshModelCatalog(queryClient);
    if (providerUsageChanged) {
      void queryClient.invalidateQueries({ queryKey: PROVIDER_USAGE_QUERY_KEY });
    }
    if (finished) void queryClient.invalidateQueries({ queryKey: toolsKey });
  }, [operations, authSessions, queryClient, toolsKey, scope]);

  // Same wire-tolerance as the poll above: render nothing over a body that
  // lacks the list rather than crash the page that contains the panel.
  const harnesses = useMemo(
    () => (data?.tools ?? []).filter((tool) => TOOL_PROVIDERS[tool.id] !== undefined),
    [data],
  );

  return {
    /** The agent harnesses only, in server order. */
    harnesses,
    /** Whether at least one harness is signed in — enough to run a session. */
    anyHarnessAuthenticated: harnesses.some((tool) => tool.authenticated),
    operationFor: (tool: SetupToolId): ToolOperation | undefined =>
      operations.find((op) => op.tool === tool),
    authSessionFor: (tool: SetupToolId): ToolAuthSession | undefined =>
      authSessions.find((session) => session.tool === tool),
    actionError,
    isPending,
    isError,
    error,
    start,
    startAuth,
    submitCode,
    cancelAuth,
  };
}
