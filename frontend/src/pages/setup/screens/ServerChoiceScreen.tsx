import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { SetupScreen } from "./SetupScreen";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { ServerChoice } from "@/pages/setup/machine";

interface ServerChoiceScreenProps {
  initialValue?: ServerChoice;
  onContinue: (choice: ServerChoice) => void;
  onBack: () => void;
  onContinueLater: () => void;
}

export function ServerChoiceScreen({
  initialValue,
  onContinue,
  onBack,
  onContinueLater,
}: ServerChoiceScreenProps) {
  const [choice, setChoice] = useState<ServerChoice>(initialValue ?? "create");

  return (
    <SetupScreen
      title="Do you have a server?"
      description="Hive needs a fresh, dedicated server (Ubuntu 22.04/24.04 or Debian 12). Create one at a provider or point Hive at one you already have."
      onContinue={() => onContinue(choice)}
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
      <RadioGroup value={choice} onValueChange={(v) => setChoice(v as ServerChoice)}>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/50 p-3 text-sm">
          <RadioGroupItem value="create" className="mt-0.5" />
          <span>
            <span className="font-medium text-foreground">Create a new VPS</span>
            <span className="mt-1 block text-muted-foreground">
              Recommended. Spin one up at{" "}
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
              with your usual SSH key.
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/50 p-3 text-sm">
          <RadioGroupItem value="existing" className="mt-0.5" />
          <span>
            <span className="font-medium text-foreground">I already have a server</span>
            <span className="mt-1 block text-muted-foreground">
              A fresh, pristine box you can log into as root over SSH.
            </span>
          </span>
        </label>
      </RadioGroup>
    </SetupScreen>
  );
}
