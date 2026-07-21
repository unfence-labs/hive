import { useState } from "react";
import { SetupScreen } from "./SetupScreen";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ExternalLink } from "lucide-react";
import type { ProvisionClient } from "@/lib/provision-client";
import type { SetupErrorCode } from "@hive/shared/setup-errors";

interface ServerIpScreenProps {
  client: ProvisionClient;
  initialValue?: string;
  onContinue: (ip: string, fingerprint: string, hostKey: string, user?: string) => void;
  onBack: () => void;
  onContinueLater: () => void;
  onError: (code: SetupErrorCode) => void;
}

/** Split an optional `user@` prefix off the host input. */
export function parseHostInput(value: string): { host: string; user?: string } {
  const v = value.trim();
  const at = v.lastIndexOf("@");
  if (at === -1) return { host: v };
  const user = v.slice(0, at);
  return user ? { host: v.slice(at + 1), user } : { host: v.slice(at + 1) };
}

/** Accept an IPv4 or a hostname, optionally `user@`-prefixed; the reachability check does the real work. */
export function looksLikeHost(value: string): boolean {
  const { host, user } = parseHostInput(value);
  if (!host || host.startsWith("-")) return false;
  if (user !== undefined && !/^[a-zA-Z_][a-zA-Z0-9._-]*$/.test(user)) return false;
  return /^[a-zA-Z0-9.:-]+$/.test(host);
}

export function ServerIpScreen({
  client,
  initialValue = "",
  onContinue,
  onBack,
  onContinueLater,
  onError,
}: ServerIpScreenProps) {
  const [value, setValue] = useState(initialValue);
  const [checking, setChecking] = useState(false);

  const handleContinue = async () => {
    const { host, user } = parseHostInput(value);
    setChecking(true);
    try {
      const result = await client.testConnection(host);
      if ("error" in result) {
        onError(result.error);
        return;
      }
      onContinue(host, result.fingerprint, result.hostKey, user);
    } catch {
      onError("SSH_UNREACHABLE");
    } finally {
      setChecking(false);
    }
  };

  return (
    <SetupScreen
      title="Connect to your server"
      description="Use a fresh Ubuntu 22.04/24.04 or Debian 12 server. Hive connects over SSH as root; use user@host for a user with passwordless sudo."
      onContinue={() => void handleContinue()}
      continueDisabled={!looksLikeHost(value) || checking}
      continueLabel={checking ? "Connecting…" : "Connect"}
      onBack={onBack}
      onContinueLater={onContinueLater}
      footer={checking ? <Spinner className="h-4 w-4" /> : undefined}
    >
      <div className="mb-4 text-xs text-muted-foreground">
        Need a server? Create one with your SSH key at{" "}
        <a href="https://www.hetzner.com/cloud" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
          Hetzner <ExternalLink className="h-3 w-3" />
        </a>{" "}
        or{" "}
        <a href="https://www.digitalocean.com/products/droplets" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
          DigitalOcean <ExternalLink className="h-3 w-3" />
        </a>.
      </div>
      <Input
        aria-label="Server IP or hostname"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="root@203.0.113.10"
        autoComplete="off"
        spellCheck={false}
        className="font-mono text-xs"
        onKeyDown={(e) => {
          if (e.key === "Enter" && looksLikeHost(value) && !checking) void handleContinue();
        }}
      />
    </SetupScreen>
  );
}
