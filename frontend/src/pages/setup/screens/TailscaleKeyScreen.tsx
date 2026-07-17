import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { SetupScreen } from "./SetupScreen";
import { Input } from "@/components/ui/input";

interface TailscaleKeyScreenProps {
  initialValue?: string;
  onContinue: (authKey: string) => void;
  onBack: () => void;
  onContinueLater: () => void;
}

/** Tagged auth keys look like `tskey-auth-…`. */
export function isValidTailscaleKey(value: string): boolean {
  return /^tskey-auth-[A-Za-z0-9-]+$/.test(value.trim());
}

export function TailscaleKeyScreen({
  initialValue = "",
  onContinue,
  onBack,
  onContinueLater,
}: TailscaleKeyScreenProps) {
  const [value, setValue] = useState(initialValue);
  const valid = isValidTailscaleKey(value);

  return (
    <SetupScreen
      title="Paste your Tailscale auth key"
      description={
        <>
          Generate a key tagged <code className="rounded bg-muted px-1">tag:hive</code> in the{" "}
          <a
            href="https://login.tailscale.com/admin/settings/keys"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Tailscale admin console <ExternalLink className="h-3 w-3" />
          </a>
          . Tagged keys never expire, so your server stays on the tailnet.
        </>
      }
      onContinue={() => onContinue(value.trim())}
      continueDisabled={!valid}
      onBack={onBack}
      onContinueLater={onContinueLater}
    >
      <Input
        aria-label="Tailscale auth key"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="tskey-auth-…"
        autoComplete="off"
        spellCheck={false}
        className="font-mono text-xs"
      />
      {value && !valid && (
        <p className="mt-2 text-xs text-destructive">
          That does not look like a Tailscale auth key (expected <code>tskey-auth-…</code>).
        </p>
      )}
    </SetupScreen>
  );
}
