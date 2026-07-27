import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Github, Loader2, LogOut, ExternalLink, AlertCircle, CheckCircle2, Terminal, XCircle } from "lucide-react";
import {
  isToolAuthTerminal,
  TOOL_AUTH_FAILURE_HINTS,
} from "@hive/shared/setup-types";
import { SettingsHeader } from "@/components/AppLayout";
import { CenterCard } from "@/components/CenterCard";
import { cn } from "@/lib/utils";
import { api } from "@/hooks/useApi";
import { openExternal } from "@/lib/open-external";
import { SignInPrompt } from "@/components/setup/SignInPrompt";
import { createSetupApi } from "@/lib/setup-api";

interface GitHubUser {
  login: string;
  name: string;
  email: string;
  avatarUrl: string;
}

interface AccountStatus {
  ghInstalled: boolean;
  authenticated: boolean;
  user?: GitHubUser | null;
}

type PageState =
  | { kind: "loading" }
  | { kind: "no-gh" }
  | { kind: "disconnected" }
  | { kind: "connecting"; userCode: string; verificationUri: string }
  | { kind: "connected"; user: GitHubUser }
  | { kind: "error"; message: string; retryable: boolean };

/** How often the server-side sign-in is re-read while it is live. */
const POLL_INTERVAL_MS = 2_000;

// Shared with the tools panel on purpose: both watch the same server state.
const SETUP_STATUS_KEY = ["setup", "status", "default"] as const;

export default function AccountSettings() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<PageState>({ kind: "loading" });
  const [disconnecting, setDisconnecting] = useState(false);
  const setupApi = useMemo(() => createSetupApi(), []);

  const statusQuery = useQuery({
    queryKey: ["account", "status"],
    queryFn: () => api.get<AccountStatus>("/api/account/status"),
    retry: 0,
  });

  // The sign-in itself runs on the server as a ToolAuthSession; this page only
  // watches it through the same cheap status poll the tools panel uses, which
  // is what lets a reload land back on the code instead of losing it.
  const authQuery = useQuery({
    queryKey: SETUP_STATUS_KEY,
    queryFn: ({ signal }) => setupApi.getStatus(signal),
    refetchInterval: (query) =>
      query.state.data?.authSessions.some(
        (session) => session.tool === "gh" && !isToolAuthTerminal(session.state),
      )
        ? POLL_INTERVAL_MS
        : false,
  });
  const ghSession = authQuery.data?.authSessions.find((session) => session.tool === "gh");

  const connect = useMutation({
    mutationFn: () => setupApi.startAuth("gh"),
    onError: (err) =>
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not start sign-in.",
        retryable: true,
      }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: SETUP_STATUS_KEY }),
  });

  const cancelAuth = useMutation({
    mutationFn: () => setupApi.cancelAuth("gh"),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: SETUP_STATUS_KEY }),
  });

  // Map query result to page state (only when in "loading" state)
  useEffect(() => {
    if (state.kind !== "loading") return;
    if (statusQuery.isFetching) return;

    if (statusQuery.error) {
      setState({ kind: "error", message: "Could not reach backend", retryable: true });
    } else if (statusQuery.data) {
      const status = statusQuery.data;
      if (!status.ghInstalled) {
        setState({ kind: "no-gh" });
      } else if (status.authenticated && status.user) {
        setState({ kind: "connected", user: status.user });
      } else {
        setState({ kind: "disconnected" });
      }
    }
  }, [state.kind, statusQuery.isFetching, statusQuery.data, statusQuery.error]);

  // Mirror the server-side session into the page's own state. Finished
  // sessions linger on the server for a while, so only an ending this page
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
      void queryClient.resetQueries({ queryKey: ["account", "status"] });
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
  }, [ghSession, queryClient]);

  const handleConnect = () => connect.mutate();

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await api.post("/api/account/disconnect");
      setState({ kind: "disconnected" });
      queryClient.setQueryData<AccountStatus>(["account", "status"], {
        ghInstalled: true,
        authenticated: false,
      });
    } catch {
      // stay on connected, will retry
    } finally {
      setDisconnecting(false);
    }
  };

  const handleRetry = () => {
    setState({ kind: "loading" });
    void queryClient.resetQueries({ queryKey: ["account", "status"] });
  };

  const handleCancelConnect = () => {
    cancelAuth.mutate();
    setState({ kind: "disconnected" });
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <SettingsHeader>
        <h1 className="text-sm font-medium">Account</h1>
      </SettingsHeader>

      <CenterCard scroll>
      {state.kind === "loading" ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 motion-safe:animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="max-w-2xl space-y-6 px-4 py-5">
          {state.kind === "no-gh" && (
            <section className="rounded-lg border border-border/50 bg-card/50 p-5">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
                <div>
                  <h2 className="text-sm font-medium">GitHub CLI not found</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    The GitHub CLI (<code className="rounded bg-muted px-1 py-0.5 text-[11px]">gh</code>) is required but was not found on the server.
                  </p>
                  <button
                    type="button"
                    onClick={() => void openExternal("https://cli.github.com")}
                    className="mt-3 inline-flex cursor-pointer items-center gap-1.5 text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm"
                  >
                    Install GitHub CLI
                    <ExternalLink className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </section>
          )}

          {state.kind === "disconnected" && (
            <section className="rounded-lg border border-border/50 bg-card/50 p-5">
              <div className="flex flex-col items-center py-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/50">
                  <Github className="h-6 w-6 text-muted-foreground" />
                </div>
                <h2 className="mt-3 text-sm font-medium">Not connected</h2>
                <p className="mt-1 text-center text-xs text-muted-foreground">
                  Connect your GitHub account to enable PR tracking and automatic git credentials.
                </p>
                <button
                  type="button"
                  onClick={handleConnect}
                  className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-md bg-[#24292f] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#24292f]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <Github className="h-3.5 w-3.5" />
                  Connect with GitHub
                </button>
              </div>
            </section>
          )}

          {state.kind === "connecting" && (
            <section className="rounded-lg border border-border/50 bg-card/50 p-5">
              <h2 className="text-sm font-medium">Enter this code on GitHub</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Copy the code below and enter it at the GitHub verification page.
              </p>
              <SignInPrompt
                inputId="github-sign-in-code"
                verificationUri={state.verificationUri}
                userCode={state.userCode}
                onCancel={handleCancelConnect}
              />
            </section>
          )}

          {state.kind === "connected" && (
            <section className="rounded-lg border border-border/50 bg-card/50 p-5">
              <div className="flex items-center gap-4">
                {state.user.avatarUrl ? (
                  <img
                    src={state.user.avatarUrl}
                    alt={`${state.user.login}'s avatar`}
                    className="h-16 w-16 rounded-full"
                  />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                    <Github className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-semibold">
                    {state.user.name || state.user.login}
                  </h2>
                  {state.user.email && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{state.user.email}</p>
                  )}
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <Github className="h-3 w-3" />
                    {state.user.login}
                  </p>
                </div>
              </div>
              <div className="mt-4 border-t border-border/50 pt-4">
                <button
                  type="button"
                  onClick={() => void handleDisconnect()}
                  disabled={disconnecting}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-2 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    disconnecting && "pointer-events-none opacity-60",
                  )}
                >
                  {disconnecting
                    ? <Loader2 className="h-3 w-3 motion-safe:animate-spin" />
                    : <LogOut className="h-3 w-3" />}
                  Disconnect
                </button>
              </div>
            </section>
          )}

          {state.kind === "error" && (
            <section className="rounded-lg border border-border/50 bg-card/50 p-5" role="alert">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div>
                  <h2 className="text-sm font-medium">Something went wrong</h2>
                  <p className="mt-1 text-xs text-muted-foreground">{state.message}</p>
                  {state.retryable && (
                    <button
                      type="button"
                      onClick={handleRetry}
                      className="mt-3 inline-flex cursor-pointer items-center gap-1.5 text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm"
                    >
                      Try again
                    </button>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* GitHub CLI integration status */}
          <section className="rounded-lg border border-border/50 bg-card/50 p-5">
            <div className="flex items-start gap-3">
              {state.kind === "connected" ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-foreground" />
              ) : state.kind === "no-gh" ? (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              ) : (
                <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <div>
                <h2 className="text-sm font-medium">GitHub CLI integration</h2>
                {state.kind === "connected" && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Authenticated and ready.
                  </p>
                )}
                {state.kind === "no-gh" && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    GitHub CLI (<code className="rounded bg-muted px-1 py-0.5 text-[11px]">gh</code>) is not installed.
                  </p>
                )}
                {(state.kind === "disconnected" || state.kind === "connecting" || state.kind === "error") && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    GitHub CLI is installed but not authenticated.
                  </p>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
      </CenterCard>
    </div>
  );
}
