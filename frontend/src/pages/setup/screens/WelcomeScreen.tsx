import { SetupScreen } from "./SetupScreen";
import { Button } from "@/components/ui/button";

interface WelcomeScreenProps {
  onContinue: () => void;
  onConnectExisting?: () => void;
}

export function WelcomeScreen({ onContinue, onConnectExisting }: WelcomeScreenProps) {
  return (
    <SetupScreen
      title="Set up a Hive server"
      description="Hive runs on a small server you own, reachable over your private Tailscale network. This wizard installs it over SSH."
      onContinue={onContinue}
      continueLabel="Get started"
    >
      <ul className="space-y-2 text-sm text-muted-foreground">
        <li>1. Add the server to your Tailscale network.</li>
        <li>2. Connect with your existing SSH key.</li>
        <li>3. Install Hive and connect your development tools.</li>
      </ul>
      {onConnectExisting && (
        <Button type="button" variant="outline" className="mt-6" onClick={onConnectExisting}>
          Connect to an existing server
        </Button>
      )}
    </SetupScreen>
  );
}
