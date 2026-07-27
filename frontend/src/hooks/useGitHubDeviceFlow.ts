import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/hooks/useApi";

/**
 * GitHub sign-in, driven against GitHub's device-code endpoints.
 *
 * Hive talks to GitHub itself rather than reading the `gh` CLI's screen — it
 * asks for a device code, shows it, polls for the token, and then configures
 * both the CLI and git's credential helper. This hook is the client half of
 * that, and it is a hook so the Account page and the tools panel drive one
 * implementation rather than two that drift.
 */

export interface GitHubUser {
  login: string;
  name: string;
  email: string;
  avatarUrl: string;
}

export interface GitHubAccountStatus {
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
  /**
   * Set when the token was stored and `gh` signed in, but pointing git at
   * those credentials failed. Reported rather than dropped: it surfaces later
   * as a push that fails for no visible reason.
   */
  gitCredentialError?: string;
}

export type GitHubConnectPhase =
  | { kind: "idle" }
  | { kind: "connecting"; userCode: string; verificationUri: string }
  | { kind: "connected"; user: GitHubUser; gitCredentialError?: string }
  | { kind: "error"; message: string };

/** GitHub's default when it does not say otherwise, in seconds. */
const DEFAULT_POLL_INTERVAL = 5;

/** Consecutive transport failures tolerated before giving up on the attempt. */
const MAX_POLL_ERRORS = 3;

export function useGitHubDeviceFlow(): {
  phase: GitHubConnectPhase;
  connect: () => Promise<void>;
  cancel: () => void;
  reset: () => void;
} {
  const [phase, setPhase] = useState<GitHubConnectPhase>({ kind: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interval = useRef(DEFAULT_POLL_INTERVAL);

  const stop = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => stop, [stop]);

  const startPolling = useCallback(
    (userCode: string, verificationUri: string) => {
      let errors = 0;
      const poll = async (): Promise<void> => {
        try {
          const res = await api.post<PollResponse>("/api/account/connect/poll");
          errors = 0;
          if (res.status === "pending") {
            timer.current = setTimeout(poll, interval.current * 1000);
          } else if (res.status === "slow_down") {
            // GitHub rations this endpoint; obey the pace it asks for.
            if (res.interval) interval.current = res.interval;
            timer.current = setTimeout(poll, interval.current * 1000);
          } else if (res.status === "complete" && res.user) {
            setPhase({
              kind: "connected",
              user: res.user,
              ...(res.gitCredentialError
                ? { gitCredentialError: res.gitCredentialError }
                : {}),
            });
          } else if (res.status === "expired") {
            setPhase({ kind: "error", message: "Authorization timed out. Please try again." });
          } else if (res.status === "denied") {
            setPhase({ kind: "error", message: "Authorization was denied." });
          }
        } catch (err) {
          errors += 1;
          // One failed poll is a blip in a flow that lasts minutes; three in a
          // row is the server being gone.
          if (errors >= MAX_POLL_ERRORS) {
            const detail = err instanceof Error ? err.message : "Connection failed";
            setPhase({ kind: "error", message: `GitHub login failed: ${detail}` });
          } else {
            timer.current = setTimeout(poll, interval.current * 1000);
          }
        }
      };
      setPhase({ kind: "connecting", userCode, verificationUri });
      timer.current = setTimeout(poll, interval.current * 1000);
    },
    [],
  );

  const connect = useCallback(async () => {
    stop();
    try {
      const res = await api.post<ConnectResponse>("/api/account/connect");
      interval.current = res.interval || DEFAULT_POLL_INTERVAL;
      startPolling(res.userCode, res.verificationUri);
    } catch {
      setPhase({ kind: "error", message: "Failed to start GitHub connection flow" });
    }
  }, [startPolling, stop]);

  const cancel = useCallback(() => {
    stop();
    setPhase({ kind: "idle" });
  }, [stop]);

  const reset = useCallback(() => {
    stop();
    interval.current = DEFAULT_POLL_INTERVAL;
    setPhase({ kind: "idle" });
  }, [stop]);

  return { phase, connect, cancel, reset };
}
