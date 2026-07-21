import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { SetupScreen } from "./SetupScreen";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface TailscaleKeyScreenProps {
  initialValue?: string;
  onContinue: (authKey: string, skipTailscale: boolean) => void;
  onBack: () => void;
  onContinueLater: () => void;
}

/**
 * Full auth keys are `tskey-auth-<id>-<secret>`. Requiring both segments
 * catches the classic mistake of pasting the key ID from the keys list
 * instead of the full secret (shown only once at creation).
 */
export function isValidTailscaleKey(value: string): boolean {
  return /^tskey-auth-[A-Za-z0-9]+-[A-Za-z0-9]+$/.test(value.trim());
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
      title="Connect the server to Tailscale"
      description={
        <>
          Install and sign in to Tailscale on this computer, then generate a key tagged{" "}
          <code className="rounded bg-muted px-1">tag:hive</code> in the{" "}
          <a
            href="https://login.tailscale.com/admin/settings/keys"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Tailscale admin console <ExternalLink className="h-3 w-3" />
          </a>
          . Hive uses it once to add the server to your private network.
        </>
      }
      onContinue={() => onContinue(value.trim(), false)}
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
          That does not look like a full Tailscale auth key (expected{" "}
          <code>tskey-auth-&lt;id&gt;-&lt;secret&gt;</code>). Paste the complete key shown once
          when it was generated — not the key ID from the list.
        </p>
      )}
      {import.meta.env.DEV && (
        <div className="mt-5 border-t border-border/40 pt-4">
          <p className="mb-2 text-xs text-muted-foreground">
            Local development only: provision a VM without joining a tailnet.
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => onContinue("", true)}>
            Use a local VM
          </Button>
        </div>
      )}
    </SetupScreen>
  );
}
