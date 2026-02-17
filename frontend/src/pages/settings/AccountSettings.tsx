import { useCallback, useEffect, useRef, useState } from "react";
import { Github, Loader2, LogOut, ExternalLink, Copy, Check, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/hooks/useApi";
import { openExternal } from "@/lib/open-external";

interface GitHubUser {
  login: string;
  name: string;
  email: string;
  avatarUrl: string;
}

interface AccountStatus {
  ghInstalled: boolean;
  authenticated: boolean;
  user?: GitHubUser;
}

interface ConnectResponse {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

interface PollResponse {
  status: "pending" | "slow_down" | "expired" | "denied" | "complete";
  user?: GitHubUser;
  interval?: number;
}

type PageState =
  | { kind: "loading" }
  | { kind: "no-gh" }
  | { kind: "disconnected" }
  | { kind: "connecting"; userCode: string; verificationUri: string }
  | { kind: "connected"; user: GitHubUser }
  | { kind: "error"; message: string; retryable: boolean };

export default function AccountSettings() {
  const [state, setState] = useState<PageState>({ kind: "loading" });
  const [disconnecting, setDisconnecting] = useState(false);
  const [copied, setCopied] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollInterval = useRef(5);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const checkStatus = useCallback(async () => {
    try {
      const status = await api.get<AccountStatus>("/api/account/status");
      if (!status.ghInstalled) {
        setState({ kind: "no-gh" });
      } else if (status.authenticated && status.user) {
        setState({ kind: "connected", user: status.user });
      } else {
        setState({ kind: "disconnected" });
      }
    } catch {
      setState({ kind: "error", message: "Could not reach backend", retryable: true });
    }
  }, []);

  useEffect(() => {
    void checkStatus();
    return stopPolling;
  }, [checkStatus, stopPolling]);

  const startPolling = useCallback(
    (userCode: string, verificationUri: string) => {
      let errorCount = 0;
      const poll = async () => {
        try {
          const res = await api.post<PollResponse>("/api/account/connect/poll");
          errorCount = 0;
          if (res.status === "pending") {
            pollTimer.current = setTimeout(poll, pollInterval.current * 1000);
          } else if (res.status === "slow_down") {
            if (res.interval) pollInterval.current = res.interval;
            pollTimer.current = setTimeout(poll, pollInterval.current * 1000);
          } else if (res.status === "complete" && res.user) {
            setState({ kind: "connected", user: res.user });
          } else if (res.status === "expired") {
            setState({ kind: "error", message: "Authorization timed out. Please try again.", retryable: true });
          } else if (res.status === "denied") {
            setState({ kind: "error", message: "Authorization was denied.", retryable: true });
          }
        } catch (err) {
          errorCount++;
          if (errorCount >= 3) {
            const msg = err instanceof Error ? err.message : "Connection failed";
            setState({ kind: "error", message: `GitHub login failed: ${msg}`, retryable: true });
          } else {
            pollTimer.current = setTimeout(poll, pollInterval.current * 1000);
          }
        }
      };
      setState({ kind: "connecting", userCode, verificationUri });
      pollTimer.current = setTimeout(poll, pollInterval.current * 1000);
    },
    [],
  );

  const handleConnect = async () => {
    try {
      const res = await api.post<ConnectResponse>("/api/account/connect");
      pollInterval.current = res.interval || 5;
      startPolling(res.userCode, res.verificationUri);
    } catch {
      setState({ kind: "error", message: "Failed to start GitHub connection flow", retryable: true });
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await api.post("/api/account/disconnect");
      setState({ kind: "disconnected" });
    } catch {
      // stay on connected, will retry
    } finally {
      setDisconnecting(false);
    }
  };

  const handleCopyCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRetry = () => {
    setState({ kind: "loading" });
    void checkStatus();
  };

  if (state.kind === "loading") return null;

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="border-b border-border/50 px-8 py-5" data-tauri-drag-region>
        <h1 className="text-base font-semibold">Account</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Connect your GitHub account to enable PR tracking and git authentication.
        </p>
      </div>

      <div className="max-w-2xl space-y-6 px-8 py-6">
        {state.kind === "no-gh" && (
          <section className="rounded-lg border border-border/50 bg-card/50 p-5">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div>
                <h2 className="text-sm font-medium">GitHub CLI not found</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  The GitHub CLI (<code className="rounded bg-muted px-1 py-0.5 text-[11px]">gh</code>) is required but was not found on the server.
                </p>
                <button
                  type="button"
                  onClick={() => void openExternal("https://cli.github.com")}
                  className="mt-3 inline-flex cursor-pointer items-center gap-1.5 text-xs text-primary hover:underline"
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
                onClick={() => void handleConnect()}
                className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-md bg-[#24292f] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#24292f]/90"
              >
                <Github className="h-3.5 w-3.5" />
                Connect with GitHub
              </button>
            </div>
          </section>
        )}

        {state.kind === "connecting" && (
          <section className="rounded-lg border border-border/50 bg-card/50 p-5">
            <div className="flex flex-col items-center py-4">
              <h2 className="text-sm font-medium">Enter this code on GitHub</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Copy the code below and enter it at the GitHub verification page.
              </p>
              <div className="mt-4 flex items-center gap-2">
                <code className="rounded-lg border border-border bg-muted/50 px-4 py-2 font-mono text-xl font-bold tracking-widest">
                  {state.userCode}
                </code>
                <button
                  type="button"
                  onClick={() => void handleCopyCode(state.userCode)}
                  className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                  title="Copy code"
                >
                  {copied
                    ? <Check className="h-4 w-4 text-emerald-500" />
                    : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <button
                type="button"
                onClick={() => void openExternal(state.verificationUri)}
                className="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Open GitHub
                <ExternalLink className="h-3 w-3" />
              </button>
              <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Waiting for authorization...
              </div>
            </div>
          </section>
        )}

        {state.kind === "connected" && (
          <section className="rounded-lg border border-border/50 bg-card/50 p-5">
            <div className="flex items-center gap-4">
              {state.user.avatarUrl ? (
                <img
                  src={state.user.avatarUrl}
                  alt={state.user.login}
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
                  "inline-flex cursor-pointer items-center gap-2 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground",
                  disconnecting && "pointer-events-none opacity-60",
                )}
              >
                {disconnecting
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <LogOut className="h-3 w-3" />}
                Disconnect
              </button>
            </div>
          </section>
        )}

        {state.kind === "error" && (
          <section className="rounded-lg border border-border/50 bg-card/50 p-5">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <div>
                <h2 className="text-sm font-medium">Something went wrong</h2>
                <p className="mt-1 text-xs text-muted-foreground">{state.message}</p>
                {state.retryable && (
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="mt-3 inline-flex cursor-pointer items-center gap-1.5 text-xs text-primary hover:underline"
                  >
                    Try again
                  </button>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
