import { useEffect, useState } from "react";
import { KeyRound, Lock, RefreshCw } from "lucide-react";
import { SetupScreen } from "./SetupScreen";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
  const [error, setError] = useState<string | null>(null);
  const [refreshAttempt, setRefreshAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setKeys(null);
    setError(null);
    void client.listKeys()
      .then((found) => {
        if (cancelled) return;
        setKeys(found);
        const usable = (key: SshKey) => !key.encrypted || key.agentLoaded;
        setSelected((current) => {
          if (current && found.some((key) => key.path === current && usable(key))) return current;
          if (initialValue && found.some((key) => key.path === initialValue && usable(key))) {
            return initialValue;
          }
          return found.find(usable)?.path;
        });
      })
      .catch((caught) => {
        if (cancelled) return;
        setKeys([]);
        setError(caught instanceof Error ? caught.message : "SSH keys could not be listed.");
      });
    return () => {
      cancelled = true;
    };
  }, [client, initialValue, refreshAttempt]);

  return (
    <SetupScreen
      title="Select the SSH key that reaches your server"
      description="Hive uses your existing SSH key to connect. The private key never leaves this device; only its file path is stored."
      onContinue={() => selected && onContinue(selected)}
      continueDisabled={!selected}
      onBack={onBack}
      onContinueLater={onContinueLater}
    >
      {error ? (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      ) : keys === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> Looking for SSH keys…
        </div>
      ) : keys.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No SSH keys found under <code>~/.ssh</code>. Create one at your provider, then come back.
        </p>
      ) : (
        <>
          <RadioGroup value={selected} onValueChange={setSelected}>
            {keys.map((key) => {
              const unavailable = Boolean(key.encrypted && !key.agentLoaded);
              return (
                <label
                  key={key.path}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border border-border/50 p-3 text-sm",
                    unavailable ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                  )}
                >
                  <RadioGroupItem value={key.path} disabled={unavailable} />
                  <KeyRound className="h-4 w-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-foreground">{key.label}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{key.type}</span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground/60">
                      {key.path}
                    </span>
                    {unavailable && (
                      <span className="mt-1 block text-[11px] text-muted-foreground">
                        Load this key with <code>ssh-add {key.path}</code>, then refresh.
                      </span>
                    )}
                  </span>
                  {key.encrypted && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Lock className="h-3 w-3" />
                      {key.agentLoaded ? "agent ready" : "locked"}
                    </span>
                  )}
                </label>
              );
            })}
          </RadioGroup>
          {keys.some((key) => key.encrypted && !key.agentLoaded) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-3 text-muted-foreground"
              onClick={() => setRefreshAttempt((attempt) => attempt + 1)}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh keys
            </Button>
          )}
        </>
      )}
    </SetupScreen>
  );
}
