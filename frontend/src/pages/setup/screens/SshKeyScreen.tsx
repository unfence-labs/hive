import { useEffect, useState } from "react";
import { KeyRound, Lock } from "lucide-react";
import { SetupScreen } from "./SetupScreen";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import type { ProvisionClient, SshKey } from "@/lib/provision-client";

interface SshKeyScreenProps {
  client: ProvisionClient;
  initialValue?: string;
  onContinue: (keyPath: string) => void;
  onBack: () => void;
  onContinueLater: () => void;
}

export function SshKeyScreen({
  client,
  initialValue,
  onContinue,
  onBack,
  onContinueLater,
}: SshKeyScreenProps) {
  const [keys, setKeys] = useState<SshKey[] | null>(null);
  const [selected, setSelected] = useState<string | undefined>(initialValue);

  useEffect(() => {
    let cancelled = false;
    void client.listKeys().then((found) => {
      if (cancelled) return;
      setKeys(found);
      if (!initialValue && found.length > 0) setSelected(found[0].path);
    });
    return () => {
      cancelled = true;
    };
  }, [client, initialValue]);

  return (
    <SetupScreen
      title="Select the SSH key that reaches your server"
      description="Hive uses your existing SSH key to connect. It never reads or copies the key — only the file path is stored."
      onContinue={() => selected && onContinue(selected)}
      continueDisabled={!selected}
      onBack={onBack}
      onContinueLater={onContinueLater}
    >
      {keys === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> Looking for SSH keys…
        </div>
      ) : keys.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No SSH keys found under <code>~/.ssh</code>. Create one at your provider, then come back.
        </p>
      ) : (
        <RadioGroup value={selected} onValueChange={setSelected}>
          {keys.map((key) => (
            <label
              key={key.path}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-border/50 p-3 text-sm"
            >
              <RadioGroupItem value={key.path} />
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="font-medium text-foreground">{key.label}</span>
                <span className="ml-2 text-xs text-muted-foreground">{key.type}</span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground/60">
                  {key.path}
                </span>
              </span>
              {key.encrypted && (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Lock className="h-3 w-3" /> passphrase
                </span>
              )}
            </label>
          ))}
        </RadioGroup>
      )}
    </SetupScreen>
  );
}
