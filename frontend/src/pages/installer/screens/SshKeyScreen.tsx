import { useCallback, useEffect, useState } from "react";
import { KeyRound, Lock, RefreshCw } from "lucide-react";
import { InstallerScreen } from "./InstallerScreen";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { toProvisionError, type ProvisionClient, type SshKey } from "@/lib/provision-client";
import type { InstallerInputs } from "@/pages/installer/machine";

interface SshKeyScreenProps {
  client: ProvisionClient;
  inputs: InstallerInputs;
  onContinue: (values: Partial<InstallerInputs>) => void;
  onBack: () => void;
}

/**
 * Pick the key that reaches the server. Keys that cannot authenticate without a
 * prompt — passphrase-protected and not held by an agent — are listed and
 * marked rather than hidden, because "my key is missing" is a worse question to
 * answer than "my key is locked".
 */
export function SshKeyScreen({ client, inputs, onContinue, onBack }: SshKeyScreenProps) {
  const [keys, setKeys] = useState<SshKey[] | null>(null);
  const [selected, setSelected] = useState<string | undefined>(inputs.sshKeyPath);
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setKeys(null);
    setError(null);
    client
      .listKeys()
      .then((found) => {
        if (cancelled) return;
        setKeys(found);
        setSelected((current) => {
          const usable = found.filter((key) => key.usable);
          if (current && usable.some((key) => key.path === current)) return current;
          return usable[0]?.path;
        });
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setKeys([]);
        setError(toProvisionError(caught).detail || "SSH keys could not be listed.");
      });
    return () => {
      cancelled = true;
    };
  }, [client, scan]);

  const proceed = useCallback(() => {
    const key = keys?.find((candidate) => candidate.path === selected);
    if (!key) return;
    onContinue({ sshKeyPath: key.path, sshPublicKey: key.publicKey });
  }, [keys, onContinue, selected]);

  return (
    <InstallerScreen
      title="Choose the SSH key that reaches the server"
      description="The private key never leaves this machine; only its path is stored. Its public half is authorized on Hive's service account so editor and terminal sessions can connect."
      onContinue={proceed}
      continueDisabled={!selected}
      onBack={onBack}
      footer={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setScan((attempt) => attempt + 1)}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Scan again
        </Button>
      }
    >
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : keys === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> Looking for SSH keys…
        </div>
      ) : keys.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No private keys found under <code>~/.ssh</code>. Create one, authorize it on the server,
          then scan again.
        </p>
      ) : (
        <RadioGroup value={selected} onValueChange={setSelected}>
          {keys.map((key) => (
            <label
              key={key.path}
              className={cn(
                "flex items-center gap-3 rounded-lg border border-border/50 p-3 text-sm",
                key.usable ? "cursor-pointer" : "cursor-not-allowed opacity-60",
              )}
            >
              <RadioGroupItem value={key.path} disabled={!key.usable} aria-label={key.label} />
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="font-medium text-foreground">{key.label}</span>
                {key.keyType && (
                  <span className="ml-2 text-xs text-muted-foreground">{key.keyType}</span>
                )}
                <span className="block truncate font-mono text-[11px] text-muted-foreground/60">
                  {key.path}
                </span>
                {!key.usable && (
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    Unusable: it has a passphrase and no agent holds it. Run{" "}
                    <code>ssh-add {key.path}</code>, then scan again.
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
          ))}
        </RadioGroup>
      )}
    </InstallerScreen>
  );
}
