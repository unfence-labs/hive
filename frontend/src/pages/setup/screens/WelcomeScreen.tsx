import { SetupScreen } from "./SetupScreen";

interface WelcomeScreenProps {
  onContinue: () => void;
}

export function WelcomeScreen({ onContinue }: WelcomeScreenProps) {
  return (
    <SetupScreen
      title="Set up a Hive server"
      description="Hive runs on a small server you own, reachable only over your private Tailscale network. This wizard walks you through it — no terminal, no manual server configuration."
      onContinue={onContinue}
      continueLabel="Get started"
    >
      <ul className="space-y-2 text-sm text-muted-foreground">
        <li>1. Create a Tailscale account and paste a tagged auth key.</li>
        <li>2. Create a small VPS with your usual SSH key, paste its IP.</li>
        <li>3. Watch Hive install itself over SSH.</li>
        <li>4. Sign in to Claude (and optionally Codex / GitHub).</li>
        <li>5. Scan one QR code on your iPhone.</li>
      </ul>
    </SetupScreen>
  );
}
