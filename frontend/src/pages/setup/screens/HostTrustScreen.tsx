import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { SetupScreen } from "./SetupScreen";
import { ErrorPanel } from "./ErrorPanel";
import { parseSidecarErrorCode, type ProvisionClient } from "@/lib/provision-client";
import type { SetupError } from "@/pages/setup/machine";

interface HostTrustScreenProps {
  client: ProvisionClient;
  host: string;
  fingerprint: string;
  /** The exact keyscan line the fingerprint was computed from. */
  hostKey: string;
  onContinue: () => void;
  onBack: () => void;
  onContinueLater: () => void;
}

/**
 * Trust-on-first-use: show the server's host-key fingerprint and let the user
 * accept it, which persists the exact scanned keys to known_hosts.
 */
export function HostTrustScreen({
  client,
  host,
  fingerprint,
  hostKey,
  onContinue,
  onBack,
  onContinueLater,
}: HostTrustScreenProps) {
  const [trusting, setTrusting] = useState(false);
  const [error, setError] = useState<SetupError | null>(null);

  const handleTrust = async () => {
    setTrusting(true);
    setError(null);
    try {
      await client.trustHost(host, hostKey);
      onContinue();
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "The SSH host key could not be saved.";
      setError({ state: "host_trust", code: parseSidecarErrorCode(detail), logExcerpt: detail });
    } finally {
      setTrusting(false);
    }
  };

  return (
    <SetupScreen
      title="Verify your server's identity"
      description="This is the first time you connect to this server. Confirm its SSH fingerprint below matches what your provider shows."
      onContinue={() => void handleTrust()}
      continueLabel={trusting ? "Trusting…" : "Trust and continue"}
      continueDisabled={trusting}
      onBack={onBack}
      onContinueLater={onContinueLater}
    >
      <div className="rounded-lg border border-border/50 bg-card/50 p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span className="font-mono text-xs text-foreground">{host}</span>
        </div>
        <p className="mt-3 break-all font-mono text-xs text-foreground">{fingerprint}</p>
      </div>
      {error && (
        <div className="mt-3">
          <ErrorPanel error={error} onDismiss={() => setError(null)} />
        </div>
      )}
    </SetupScreen>
  );
}
