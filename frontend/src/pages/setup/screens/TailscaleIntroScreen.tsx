import { ExternalLink } from "lucide-react";
import { SetupScreen } from "./SetupScreen";

interface TailscaleIntroScreenProps {
  onContinue: () => void;
  onBack: () => void;
  onContinueLater: () => void;
}

export function TailscaleIntroScreen({ onContinue, onBack, onContinueLater }: TailscaleIntroScreenProps) {
  return (
    <SetupScreen
      title="Create your Tailscale network"
      description="Tailscale is a private network that lets your devices reach the server without exposing it to the internet. The free plan is plenty."
      onContinue={onContinue}
      continueLabel="I've done this"
      onBack={onBack}
      onContinueLater={onContinueLater}
    >
      <ol className="space-y-3 text-sm text-muted-foreground">
        <li>
          1. Create a Tailscale account and install the Tailscale app on this computer:{" "}
          <a
            href="https://tailscale.com/download"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            tailscale.com/download <ExternalLink className="h-3 w-3" />
          </a>
        </li>
        <li>2. Sign in so this computer joins your tailnet.</li>
      </ol>
    </SetupScreen>
  );
}
