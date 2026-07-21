import { useEffect, useState } from "react";
import { SetupScreen } from "./SetupScreen";
import { Spinner } from "@/components/ui/spinner";
import { getServerUrl } from "@/hooks/useServerUrl";

interface TailnetHandoffScreenProps {
  /** Server base URL to poll (e.g. http://100.x.y.z:3000). */
  baseUrl: string;
  onContinue: () => void;
  onBack: () => void;
  onContinueLater: () => void;
  /** Injectable for tests. */
  checkHealth?: (baseUrl: string) => Promise<boolean>;
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
  baseUrl,
  onContinue,
  onBack,
  onContinueLater,
  checkHealth = defaultCheckHealth,
}: TailnetHandoffScreenProps) {
  const [healthy, setHealthy] = useState(false);
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
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
  }, [baseUrl, checkHealth]);

  return (
    <SetupScreen
      title={healthy ? "Your server is online" : "Waiting for your server on the tailnet"}
      description={
        healthy
          ? "Hive is reachable over your private network. Time to finish the setup."
          : "Hive should appear on your tailnet within a minute or two. Make sure this computer is signed in to Tailscale."
      }
      onContinue={healthy ? onContinue : undefined}
      onBack={onBack}
      onContinueLater={onContinueLater}
    >
      {!healthy && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          Checking… {attempts > 0 && <span className="text-xs">(attempt {attempts + 1})</span>}
        </div>
      )}
      {!healthy && attempts >= 10 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Still nothing? Confirm the server shows up in your Tailscale admin console, and that this
          computer is on the same tailnet. SSH stays available as a repair channel.
        </p>
      )}
    </SetupScreen>
  );
}
