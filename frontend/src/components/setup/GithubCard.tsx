import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeviceCodeRow } from "@/components/setup/DeviceCodeRow";
import { ErrorPanel } from "@/components/setup/ErrorPanel";
import { SetupCard } from "@/components/setup/SetupCard";
import { useGithubAccount } from "@/components/setup/useGithubAccount";
import type { SetupApiTarget } from "@/lib/setup-api";

/**
 * The GitHub account as one line in a stack of setup cards, next to the agent
 * harnesses the installer's final screen already shows.
 *
 * Deliberately smaller than Settings → Account: connecting is all the installer
 * needs. There is no disconnect here — signing an account out mid-install is
 * not a thing an operator wants, and Settings does it properly.
 */
export function GithubCard({ target }: { target?: SetupApiTarget }) {
  const { state, connect, cancelConnect, signingIn } = useGithubAccount(target);

  const connecting = state.kind === "connecting";
  // An error is a failed attempt, not a dead end: the button that failed stays.
  const canConnect = state.kind === "disconnected" || state.kind === "error";

  return (
    <SetupCard
      className={state.kind === "no-gh" ? "opacity-70" : undefined}
      title="GitHub"
      status={
        state.kind === "connected" ? (
          // One span, so the words read as one sentence rather than two chips.
          <span>
            <span className="text-success-foreground">Signed in</span> as {state.user.login}
          </span>
        ) : connecting ? (
          // The sign-in under way takes the status slot, as in the tool cards.
          <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5">
            Waiting for authorization…
            <Loader2 className="h-3 w-3 animate-spin" />
          </span>
        ) : state.kind === "no-gh" ? (
          <span>GitHub CLI not installed</span>
        ) : state.kind === "loading" ? (
          <span>Checking…</span>
        ) : (
          <span>Not signed in</span>
        )
      }
      actions={
        <>
          {canConnect && (
            <Button size="sm" disabled={signingIn} onClick={connect}>
              {signingIn && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              Connect GitHub
            </Button>
          )}
          {/* The one way out of a sign-in under way, so a stalled one never
              needs a backend restart to escape. */}
          {connecting && (
            <Button size="sm" variant="ghost" onClick={cancelConnect}>
              Cancel
            </Button>
          )}
        </>
      }
    >
      {/* The same row the harness cards below open, so the stack signs in the
          one way. The waiting line and the Cancel live in the slots above. */}
      {state.kind === "connecting" && (
        <DeviceCodeRow verificationUri={state.verificationUri} userCode={state.userCode} />
      )}

      {state.kind === "error" && <ErrorPanel title="Something went wrong" detail={state.message} />}
    </SetupCard>
  );
}
