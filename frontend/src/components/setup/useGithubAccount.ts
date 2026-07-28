import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isToolAuthTerminal, TOOL_AUTH_FAILURE_HINTS } from "@hive/shared/setup-types";
import {
  createSetupApi,
  type AccountStatus,
  type GitHubUser,
  type SetupApiTarget,
} from "@/lib/setup-api";

/** How often the server-side sign-in is re-read while it is live. */
const POLL_INTERVAL_MS = 2_000;

/** What the account looks like right now, in the terms the UI renders. */
export type GithubAccountState =
  | { kind: "loading" }
  | { kind: "no-gh" }
  | { kind: "disconnected" }
  | { kind: "connecting"; userCode: string; verificationUri: string }
  | { kind: "connected"; user: GitHubUser }
  | { kind: "error"; message: string; retryable: boolean };

/**
 * The cache entry the account status lives in, scoped by server: the installer
 * reads the machine it just installed, the app reads the connected one.
 *
 * Exported because readers outside this hook share the entry it writes — a key
 * spelled out by hand elsewhere is a second copy that no disconnect updates.
 *
 * @param baseUrl The server addressed, or nothing for the connected one.
 */
export function accountStatusKey(baseUrl?: string) {
  return ["account", "status", baseUrl ?? "default"] as const;
}

/**
 * The GitHub account data layer: who is connected, the server-side sign-in that
 * connects them, and the actions that drive both.
 *
 * Split out of Settings → Account so the installer's final screen can render
 * the same flow as a compact card without a second implementation. Both take an
 * explicit target, because the installer addresses the server it just installed
 * rather than the stored connection.
 */
export function useGithubAccount(target?: SetupApiTarget) {
  const api = useMemo(() => createSetupApi(target), [target]);
  const scope = target?.baseUrl ?? "default";
  const accountKey = useMemo(() => accountStatusKey(scope), [scope]);
  // Shared with the tools panel on purpose: both watch the same server state.
  const statusKey = useMemo(() => ["setup", "status", scope] as const, [scope]);
  const queryClient = useQueryClient();

  const [state, setState] = useState<GithubAccountState>({ kind: "loading" });

  const accountQuery = useQuery({
    queryKey: accountKey,
    queryFn: ({ signal }) => api.getAccountStatus(signal),
    retry: 0,
  });

  // The sign-in itself runs on the server as a ToolAuthSession; this hook only
  // watches it through the same cheap status poll the tools panel uses, which
  // is what lets a reload land back on the code instead of losing it.
  const authQuery = useQuery({
    queryKey: statusKey,
    queryFn: ({ signal }) => api.getStatus(signal),
    refetchInterval: (query) =>
      query.state.data?.authSessions?.some(
        (session) => session.tool === "gh" && !isToolAuthTerminal(session.state),
      )
        ? POLL_INTERVAL_MS
        : false,
  });
  const ghSession = authQuery.data?.authSessions?.find((session) => session.tool === "gh");

  const connect = useMutation({
    mutationFn: () => api.startAuth("gh"),
    onError: (err) =>
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not start sign-in.",
        retryable: true,
      }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: statusKey }),
  });

  const cancelAuth = useMutation({
    mutationFn: () => api.cancelAuth("gh"),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: statusKey }),
  });

  const disconnect = useMutation({
    mutationFn: () => api.disconnectAccount(),
    onSuccess: () => {
      setState({ kind: "disconnected" });
      queryClient.setQueryData<AccountStatus>(accountKey, {
        ghInstalled: true,
        authenticated: false,
      });
    },
    // No onError: the account stays connected on screen, ready to be retried.
  });

  // Map query result to page state (only when in "loading" state)
  useEffect(() => {
    if (state.kind !== "loading") return;
    if (accountQuery.isFetching) return;

    if (accountQuery.error) {
      setState({ kind: "error", message: "Could not reach backend", retryable: true });
    } else if (accountQuery.data) {
      const status = accountQuery.data;
      if (!status.ghInstalled) {
        setState({ kind: "no-gh" });
      } else if (status.authenticated && status.user) {
        setState({ kind: "connected", user: status.user });
      } else {
        setState({ kind: "disconnected" });
      }
    }
  }, [state.kind, accountQuery.isFetching, accountQuery.data, accountQuery.error]);

  // Mirror the server-side session into this hook's own state. Finished
  // sessions linger on the server for a while, so only an ending this hook
  // watched happen counts — a sign-in that completed an hour ago is already
  // reflected in the account status.
  const liveSince = useRef<string | null>(null);
  useEffect(() => {
    if (!ghSession) return;
    if (!isToolAuthTerminal(ghSession.state)) {
      liveSince.current = ghSession.startedAt;
      if (ghSession.verificationUri && ghSession.userCode) {
        setState({
          kind: "connecting",
          userCode: ghSession.userCode,
          verificationUri: ghSession.verificationUri,
        });
      }
      return;
    }
    if (liveSince.current !== ghSession.startedAt) return;
    liveSince.current = null;
    if (ghSession.state === "connected") {
      setState({ kind: "loading" });
      void queryClient.resetQueries({ queryKey: accountKey });
    } else if (ghSession.state === "cancelled") {
      setState({ kind: "disconnected" });
    } else if (ghSession.state === "expired") {
      setState({
        kind: "error",
        message: "The sign-in code expired before it was confirmed. Start again.",
        retryable: true,
      });
    } else {
      const failure = ghSession.failure;
      setState({
        kind: "error",
        message: failure
          ? `${failure.message} ${TOOL_AUTH_FAILURE_HINTS[failure.reason]}`
          : "GitHub sign-in failed.",
        retryable: true,
      });
    }
  }, [ghSession, queryClient, accountKey]);

  return {
    state,
    /**
     * Server truth, not the state machine above. Two components render this
     * hook on the same target — the card and the screen that gates on it — and
     * a gate reading one component's local state machine could disagree with
     * what another one shows.
     */
    connected: accountQuery.data?.authenticated === true,
    /** A sign-in was asked for but has not produced a code yet. */
    signingIn:
      connect.isPending ||
      ghSession?.state === "starting" ||
      ghSession?.state === "verifying",
    disconnecting: disconnect.isPending,
    connect: () => connect.mutate(),
    cancelConnect: () => {
      cancelAuth.mutate();
      setState({ kind: "disconnected" });
    },
    disconnect: () => disconnect.mutate(),
    retry: () => {
      setState({ kind: "loading" });
      void queryClient.resetQueries({ queryKey: accountKey });
    },
  };
}
