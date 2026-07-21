import { useEffect, useState } from "react";
import { SetupScreen } from "./SetupScreen";
import { Spinner } from "@/components/ui/spinner";
import { getServerUrl } from "@/hooks/useServerUrl";
import { ErrorPanel } from "./ErrorPanel";
import { parseSidecarErrorCode, type ProvisionClient } from "@/lib/provision-client";
import type { SetupError } from "@/pages/setup/machine";

interface TailnetHandoffScreenProps {
  client?: ProvisionClient;
  host?: string;
  expectedHostKey?: string;
  /** Server base URL to poll (e.g. http://100.x.y.z:3000). */
  baseUrl: string;
  onContinue: () => void;
  onContinueLater: () => void;
  /** Injectable for tests. */
  checkHealth?: (baseUrl: string) => Promise<boolean>;
}

function trustError(error: unknown): SetupError {
  const detail = error instanceof Error ? error.message : String(error);
  return { state: "tailnet_handoff", code: parseSidecarErrorCode(detail), logExcerpt: detail };
}

// /health is unauthenticated; sending the PREVIOUS connection's bearer to the
// new server would be both useless and a token leak across hosts.
async function defaultCheckHealth(baseUrl: string): Promise<boolean> {
  const base = baseUrl || getServerUrl();
  if (!base) return false;
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export function TailnetHandoffScreen({
  client,
  host = "",
  expectedHostKey,
  baseUrl,
  onContinue,
  onContinueLater,
  checkHealth = defaultCheckHealth,
}: TailnetHandoffScreenProps) {
  const needsTrust = Boolean(client && host && expectedHostKey);
  const [trusted, setTrusted] = useState(!needsTrust);
  const [trusting, setTrusting] = useState(false);
  const [trustFailure, setTrustFailure] = useState<SetupError | null>(null);
  const [trustAttempt, setTrustAttempt] = useState(0);
  const [healthy, setHealthy] = useState(false);
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    if (!needsTrust || !client || !expectedHostKey) {
      setTrusted(true);
      setTrustFailure(null);
      return;
    }
    let cancelled = false;
    setTrusted(false);
    setTrusting(true);
    setTrustFailure(null);
    void client.trustHost(host, undefined, expectedHostKey)
      .then(() => {
        if (!cancelled) setTrusted(true);
      })
      .catch((error) => {
        if (!cancelled) setTrustFailure(trustError(error));
      })
      .finally(() => {
        if (!cancelled) setTrusting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, expectedHostKey, host, needsTrust, trustAttempt]);

  useEffect(() => {
    if (!trusted) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    setHealthy(false);
    setAttempts(0);
    const tick = async () => {
      const ok = await checkHealth(baseUrl);
      if (cancelled) return;
      if (ok) {
        setHealthy(true);
        return;
      }
      setAttempts((n) => n + 1);
      timer = setTimeout(() => void tick(), 2000);
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [baseUrl, checkHealth, trusted]);

  return (
    <SetupScreen
      title={healthy ? "Your server is online" : "Waiting for your server on the tailnet"}
      description={
        healthy
          ? "Hive is reachable over your private network. Time to finish the setup."
          : "Hive should appear on your tailnet within a minute or two. Make sure this computer is signed in to Tailscale."
      }
      onContinue={healthy ? onContinue : undefined}
      onContinueLater={onContinueLater}
    >
      {trustFailure && (
        <ErrorPanel
          error={trustFailure}
          onRetry={() => setTrustAttempt((attempt) => attempt + 1)}
          retrying={trusting}
        />
      )}
      {!trustFailure && !trusted && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> Verifying the server SSH identity…
        </div>
      )}
      {!trustFailure && trusted && !healthy && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          Checking… {attempts > 0 && <span className="text-xs">(attempt {attempts + 1})</span>}
        </div>
      )}
      {trusted && !healthy && attempts >= 10 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Still nothing? Confirm the server shows up in your Tailscale admin console, and that this
          computer is on the same tailnet. SSH stays available as a repair channel.
        </p>
      )}
    </SetupScreen>
  );
}
