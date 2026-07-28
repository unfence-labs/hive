import { TriangleAlert } from "lucide-react";
import { InstallerScreen } from "./InstallerScreen";
import { CopyButton } from "@/components/chat/CopyButton";
import { ToolsPanel } from "@/components/setup/ToolsPanel";
import type { SetupApiTarget } from "@/lib/setup-api";

interface AccountsScreenProps {
  /** The server that was just installed, addressed explicitly. */
  target: SetupApiTarget;
  /**
   * The token the install generated, shown here and never again: the server
   * keeps only its digest, and Settings does not display the stored copy.
   */
  accessToken: string;
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
export function AccountsScreen({ target, accessToken, onFinish }: AccountsScreenProps) {
  return (
    <InstallerScreen
      title="Connect your accounts"
      description="Hive is installed and running on your server, but it cannot run a session until an agent account is signed in on it. Connecting either Claude or Codex is enough — you do not need both. Nothing here is required: whatever you skip stays in Settings, where it does exactly the same thing."
      onContinue={onFinish}
      continueLabel="Open Hive"
    >
      <div className="mb-4 rounded-lg border border-warning-border bg-warning-muted p-4">
        <div className="flex items-center gap-2">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-warning-foreground" />
          <h3 className="text-sm font-medium text-foreground">Access token</h3>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Copy it now — it will not be shown again. This client already stored it; you will
          need it to connect other clients to this server.
        </p>
        <div className="mt-2 flex items-center gap-2 rounded bg-background/60 p-2">
          <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-foreground">
            {accessToken}
          </code>
          <CopyButton
            content={accessToken}
            ariaLabel="Copy the access token"
            copiedAriaLabel="Access token copied"
          />
        </div>
      </div>
      <ToolsPanel target={target} />
    </InstallerScreen>
  );
}
