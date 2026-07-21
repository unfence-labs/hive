import { PartyPopper } from "lucide-react";
import { SetupScreen } from "./SetupScreen";

interface DoneScreenProps {
  serverHost?: string;
  onFinish: () => void;
}

export function DoneScreen({ serverHost, onFinish }: DoneScreenProps) {
  return (
    <SetupScreen title="Your Hive is ready" onContinue={onFinish} continueLabel="Open Hive">
      <div className="flex flex-col items-center gap-4 text-center">
        <PartyPopper className="h-10 w-10 text-primary" />
        <p className="text-sm text-muted-foreground">
          Hive is running{serverHost ? ` on ${serverHost}` : ""} and reachable over your tailnet.
        </p>
      </div>
      <div className="mt-6 space-y-3 text-sm text-muted-foreground">
        <div className="rounded-lg border border-border/50 bg-card/50 p-3">
          <p className="font-medium text-foreground">Where things live</p>
          <p className="mt-1 text-xs">
            The backend runs as a systemd service on your server under <code>/opt/hive</code>.
          </p>
        </div>
        <div className="rounded-lg border border-border/50 bg-card/50 p-3">
          <p className="font-medium text-foreground">Updates</p>
          <p className="mt-1 text-xs">
            To update the server later, use Settings &gt; Connection — already-completed install
            steps are skipped.
          </p>
        </div>
      </div>
    </SetupScreen>
  );
}
