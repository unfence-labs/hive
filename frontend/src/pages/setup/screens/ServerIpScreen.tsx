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
  onContinue: (ip: string, fingerprint: string) => void;
  onBack: () => void;
  onContinueLater: () => void;
  onError: (code: SetupErrorCode) => void;
}

/** Accept an IPv4 or a hostname; the reachability check does the real work. */
export function looksLikeHost(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return /^[a-zA-Z0-9.:-]+$/.test(v);
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
    const host = value.trim();
    setChecking(true);
    try {
      const result = await client.testConnection(host, keyPath);
      if ("error" in result) {
        onError(result.error);
        return;
      }
      onContinue(host, result.fingerprint);
    } catch {
      onError("SSH_UNREACHABLE");
    } finally {
      setChecking(false);
    }
  };

  return (
    <SetupScreen
      title="Enter your server's IP address"
      description="Paste the public IP of the server you just created. Hive will connect over SSH on port 22."
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
        placeholder="203.0.113.10"
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
