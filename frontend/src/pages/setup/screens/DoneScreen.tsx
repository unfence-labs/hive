import { PartyPopper } from "lucide-react";
import { SetupScreen } from "./SetupScreen";

interface DoneScreenProps {
  serverHost?: string;
  serverPort: number;
  onFinish: () => void;
}

export function DoneScreen({ serverHost, serverPort, onFinish }: DoneScreenProps) {
  return (
    <SetupScreen title="Your Hive is ready" onContinue={onFinish} continueLabel="Open Hive">
      <div className="flex flex-col items-center gap-4 text-center">
        <PartyPopper className="h-10 w-10 text-primary" />
        <p className="text-sm text-muted-foreground">
          Hive is running{serverHost ? ` on ${serverHost}` : ""} and ready to use.
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
          <p className="font-medium text-foreground">Connect your iPhone</p>
          <p className="mt-1 text-xs">
            Sign in to the same tailnet on your iPhone, then use{" "}
            <code>{serverHost || "server-host"}:{serverPort}</code> in the Hive iOS app.
          </p>
        </div>
      </div>
    </SetupScreen>
  );
}
