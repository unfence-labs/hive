import { ChevronLeft } from "lucide-react";
import { SetupScreen } from "./SetupScreen";
import { Button } from "@/components/ui/button";

interface WelcomeScreenProps {
  onContinue: () => void;
  onBack?: () => void;
}

export function WelcomeScreen({ onContinue, onBack }: WelcomeScreenProps) {
  return (
    <SetupScreen
      title="Set up a Hive server"
      description="Hive runs on a small server you own, reachable over your private Tailscale network. This wizard installs it over SSH."
      onContinue={onContinue}
      continueLabel="Get started"
      footer={
        onBack && (
          <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground">
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>
        )
      }
    >
      <ul className="space-y-2 text-sm text-muted-foreground">
        <li>1. Add the server to your Tailscale network.</li>
        <li>2. Connect with your existing SSH key.</li>
        <li>3. Install Hive and connect your development tools.</li>
      </ul>
    </SetupScreen>
  );
}
