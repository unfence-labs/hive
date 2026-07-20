import { useState } from "react";
import { SetupScreen } from "./SetupScreen";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { ProvisionClient } from "@/lib/provision-client";
import type { SetupErrorCode } from "@hive/shared/setup-errors";

interface ServerIpScreenProps {
  client: ProvisionClient;
  keyPath: string;
  initialValue?: string;
  onContinue: (ip: string, fingerprint: string, user?: string) => void;
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
  if (!host) return false;
  if (user !== undefined && !/^[a-zA-Z_][a-zA-Z0-9._-]*$/.test(user)) return false;
  return /^[a-zA-Z0-9.:-]+$/.test(host);
}

export function ServerIpScreen({
  client,
  keyPath,
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
      const result = await client.testConnection(host, keyPath);
      if ("error" in result) {
        onError(result.error);
        return;
      }
      onContinue(host, result.fingerprint, user);
    } catch {
      onError("SSH_UNREACHABLE");
    } finally {
      setChecking(false);
    }
  };

  return (
    <SetupScreen
      title="Enter your server's IP address"
      description="Paste the public IP of the server you just created. Hive connects over SSH on port 22 as root; use user@ip for another user (it needs passwordless sudo)."
      onContinue={() => void handleContinue()}
      continueDisabled={!looksLikeHost(value) || checking}
      continueLabel={checking ? "Connecting…" : "Connect"}
      onBack={onBack}
      onContinueLater={onContinueLater}
      footer={checking ? <Spinner className="h-4 w-4" /> : undefined}
    >
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
