import { SetupScreen } from "./SetupScreen";

interface IosPairingScreenProps {
  host: string;
  port: number;
  onContinue: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export function IosPairingScreen({ host, port, onContinue, onBack, onSkip }: IosPairingScreenProps) {
  return (
    <SetupScreen
      title="Connect your iPhone"
      description="Install Tailscale on your iPhone (same account), then enter your server's address in the Hive iOS app."
      onContinue={onContinue}
      continueLabel="Done"
      onBack={onBack}
      footer={
        <button type="button" onClick={onSkip} className="text-sm text-muted-foreground hover:underline">
          Skip
        </button>
      }
    >
      <div className="w-full rounded-lg border border-border/50 bg-card/50 p-3 text-xs">
        <dl className="space-y-1 font-mono text-[11px]">
          <div className="flex gap-2">
            <dt className="w-16 text-muted-foreground/60">Host</dt>
            <dd className="min-w-0 break-all text-foreground">{host}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-16 text-muted-foreground/60">Port</dt>
            <dd className="text-foreground">{port}</dd>
          </div>
        </dl>
      </div>
    </SetupScreen>
  );
}
