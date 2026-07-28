import { useState } from "react";
import { InstallerScreen } from "./InstallerScreen";
import { AccessTokenCard } from "@/components/setup/AccessTokenCard";
import { GithubCard } from "@/components/setup/GithubCard";
import { ToolsPanel } from "@/components/setup/ToolsPanel";
import { useGithubAccount } from "@/components/setup/useGithubAccount";
import { useSetupTools } from "@/components/setup/useSetupTools";
import type { SetupApiTarget } from "@/lib/setup-api";

interface AccountsScreenProps {
  /** The server that was just installed, addressed explicitly. */
  target: SetupApiTarget;
  /**
   * The token the install generated, shown here and never again: the server
   * keeps only its digest, and Settings does not display the stored copy.
   */
  accessToken: string;
  /** Close the installer and show the ordinary app. */
  onFinish: () => void;
}

/**
 * The last screen: a server that runs, given the accounts to run as.
 *
 * There is no Back — the server exists and its connection is stored, so there
 * is nothing behind this screen to undo. There is a gate instead: a Hive that
 * cannot reach a repository, cannot run an agent, or whose token was never
 * copied is not a working Hive, and letting the operator out of here before
 * then only moves the same three tasks into a Settings page they have no
 * reason to open yet.
 *
 * The cards are the components Settings renders, not copies of them, pointed
 * at the new server by an explicit target rather than the stored connection.
 * `createSetupApi` takes that target for exactly this placement: the requests
 * must reach the server that was just installed, with the token that server
 * issued, and no other.
 */
export function AccountsScreen({ target, accessToken, onFinish }: AccountsScreenProps) {
  const [tokenCopied, setTokenCopied] = useState(false);
  // Both hooks are already driving the cards below; React Query dedupes on the
  // key, so reading them here to build the gate costs no extra request.
  const { connected } = useGithubAccount(target);
  const { anyHarnessAuthenticated } = useSetupTools(target);

  // Only what is left, in the order the screen presents it. The harness item
  // names the requirement rather than a card, because neither harness is
  // individually required — either one satisfies it.
  const missing = [
    tokenCopied ? undefined : "copy the access token",
    connected ? undefined : "connect GitHub",
    anyHarnessAuthenticated ? undefined : "sign in to Claude or Codex",
  ].filter((item): item is string => item !== undefined);

  return (
    <InstallerScreen
      title="Connect your accounts"
      description="Sign in on the server: GitHub for repository access, and Claude Code or Codex to run sessions. Everything here can be changed later in Settings."
      onContinue={onFinish}
      continueLabel="Open Hive"
      continueDisabled={missing.length > 0}
      hint={missing.length > 0 ? `Still to do: ${missing.join(", ")}.` : undefined}
    >
      <div className="space-y-4">
        <AccessTokenCard token={accessToken} onCopied={() => setTokenCopied(true)} />
        <GithubCard target={target} />
        <ToolsPanel target={target} />
      </div>
    </InstallerScreen>
  );
}
