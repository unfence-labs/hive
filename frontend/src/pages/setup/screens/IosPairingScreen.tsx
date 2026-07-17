import { SetupScreen } from "./SetupScreen";
import { QrCode } from "@/components/QrCode";
import { buildPairingUrl } from "@/lib/pairing";
import type { PairingPayload } from "@hive/shared/setup-types";

interface IosPairingScreenProps {
  payload: PairingPayload;
  onContinue: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export function IosPairingScreen({ payload, onContinue, onBack, onSkip }: IosPairingScreenProps) {
  const url = buildPairingUrl(payload);

  return (
    <SetupScreen
      title="Connect your iPhone"
      description="Install Tailscale on your iPhone (same account), then scan this code in the Hive iOS app."
      onContinue={onContinue}
      continueLabel="Done"
      onBack={onBack}
      footer={
        <button type="button" onClick={onSkip} className="text-sm text-muted-foreground hover:underline">
          Skip
        </button>
      }
    >
      <div className="flex flex-col items-center gap-4">
        <div className="rounded-lg border border-border/50 bg-white p-3">
          <QrCode value={url} size={220} />
        </div>
        <div className="w-full rounded-lg border border-border/50 bg-card/50 p-3 text-xs">
          <p className="mb-2 text-muted-foreground">Or enter these manually:</p>
          <dl className="space-y-1 font-mono text-[11px]">
            <div className="flex gap-2">
              <dt className="w-16 text-muted-foreground/60">Host</dt>
              <dd className="min-w-0 break-all text-foreground">{payload.host}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-16 text-muted-foreground/60">Port</dt>
              <dd className="text-foreground">{payload.port}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-16 text-muted-foreground/60">Token</dt>
              <dd className="min-w-0 break-all text-foreground">{payload.token}</dd>
            </div>
          </dl>
        </div>
      </div>
    </SetupScreen>
  );
}
