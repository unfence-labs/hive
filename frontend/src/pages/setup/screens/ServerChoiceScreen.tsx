import { ExternalLink } from "lucide-react";
import { SetupScreen } from "./SetupScreen";

interface ServerChoiceScreenProps {
  onContinue: () => void;
  onBack: () => void;
  onContinueLater: () => void;
}

export function ServerChoiceScreen({
  onContinue,
  onBack,
  onContinueLater,
}: ServerChoiceScreenProps) {
  return (
    <SetupScreen
      title="Get a server ready"
      description="Hive needs a fresh, dedicated server (Ubuntu 22.04/24.04 or Debian 12) you can log into as root over SSH."
      onContinue={onContinue}
      onBack={onBack}
      onContinueLater={onContinueLater}
    >
      <div className="mb-2 flex items-start gap-3 rounded-lg border border-dashed border-border/50 p-3 text-sm opacity-60">
        <span>
          <span className="font-medium text-foreground">
            Deploy in one click
            <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Coming soon
            </span>
          </span>
          <span className="mt-1 block text-muted-foreground">
            Hive will create and configure a server for you, no account juggling needed.
          </span>
        </span>
      </div>
      <div className="rounded-lg border border-border/50 p-3 text-sm">
        <span className="font-medium text-foreground">Don't have one yet?</span>
        <span className="mt-1 block text-muted-foreground">
          Spin one up at{" "}
          <a
            href="https://www.hetzner.com/cloud"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Hetzner <ExternalLink className="h-3 w-3" />
          </a>{" "}
          or{" "}
          <a
            href="https://www.digitalocean.com/products/droplets"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            DigitalOcean <ExternalLink className="h-3 w-3" />
          </a>{" "}
          with your usual SSH key, then continue.
        </span>
      </div>
    </SetupScreen>
  );
}
