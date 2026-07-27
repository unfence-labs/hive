import { InstallerScreen } from "./InstallerScreen";
import { ToolsPanel } from "@/components/setup/ToolsPanel";
import type { SetupApiTarget } from "@/lib/setup-api";

interface AccountsScreenProps {
  /** The server that was just installed, addressed explicitly. */
  target: SetupApiTarget;
  /** Close the installer and show the ordinary app. Always available. */
  onFinish: () => void;
}

/**
 * The last screen: a server that runs, given accounts to run as.
 *
 * It gates nothing. The install has already succeeded, so the rule that forbids
 * navigation during the install does not apply here — every sign-in is
 * optional, "Open Hive" is never disabled, and anything skipped is the same
 * panel in Settings doing the same thing.
 *
 * The panel is the component Settings renders, not a copy of it, and it is
 * pointed at the new server by an explicit target rather than left to read the
 * stored connection. `createSetupApi` takes that target for exactly this
 * placement: the requests must reach the server that was just installed, with
 * the token that server issued, and no other.
 */
export function AccountsScreen({ target, onFinish }: AccountsScreenProps) {
  return (
    <InstallerScreen
      title="Connect your accounts"
      description="Hive is installed and running on your server, but it cannot run a session until an agent account is signed in on it. Connecting either Claude or Codex is enough — you do not need both, and GitHub only adds cloning repositories and opening pull requests. Nothing here is required: whatever you skip stays in Settings, where it does exactly the same thing."
      onContinue={onFinish}
      continueLabel="Open Hive"
    >
      <ToolsPanel target={target} />
    </InstallerScreen>
  );
}
