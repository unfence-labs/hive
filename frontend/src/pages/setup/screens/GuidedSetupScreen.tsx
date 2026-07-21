import { SetupScreen } from "./SetupScreen";
import { ToolsPanel } from "./ToolsPanel";
import type { ProvisionClient } from "@/lib/provision-client";

interface GuidedSetupScreenProps {
  client: ProvisionClient;
  /**
   * The NEW server's base URL. The app-level stores still point at the
   * previous connection until the wizard's final screen commits them, so this
   * screen must talk to the freshly-provisioned backend explicitly.
   */
  baseUrl: string;
  onContinue: () => void;
  onBack: () => void;
  onContinueLater: () => void;
}

export function GuidedSetupScreen({
  client,
  baseUrl,
  onContinue,
  onBack,
  onContinueLater,
}: GuidedSetupScreenProps) {
  return (
    <SetupScreen
      title="Connect your tools"
      description="Your server is ready. Sign in to GitHub, then install and sign in to the AI agents you want."
      onContinue={onContinue}
      continueLabel="Continue"
      onBack={onBack}
      onContinueLater={onContinueLater}
    >
      <ToolsPanel client={client} baseUrl={baseUrl} />
    </SetupScreen>
  );
}
