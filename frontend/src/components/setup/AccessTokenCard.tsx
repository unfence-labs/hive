import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SetupCard } from "@/components/setup/SetupCard";
import { copyToClipboard } from "@/lib/clipboard";

/** Enough of the token to recognise it, never enough to use it. */
function truncate(token: string): string {
  return `${token.slice(0, 8)}…${token.slice(-4)}`;
}

/**
 * The access token the install issued, shown here and nowhere else.
 *
 * It carries no warning colour on purpose: it is one of the accounts this
 * screen asks for, and dressing it as an alert would make the two cards beside
 * it read as optional. What makes it unrecoverable is said in words instead.
 *
 * The status line shows it truncated so a shoulder or a screen share does not
 * hand it over; the eye reveals it, and Copy always takes the whole thing.
 * "Copied" stays once earned — this screen asks the operator to have copied
 * it, so the answer has to keep showing.
 *
 * A clipboard that refuses is handled rather than swallowed: the token is
 * revealed in full and the card says to take it by hand.
 */
export function AccessTokenCard({
  token,
  onCopied,
}: {
  token: string;
  onCopied: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const copy = async (): Promise<void> => {
    try {
      await copyToClipboard(token);
      setFailed(false);
      setCopied(true);
    } catch {
      // The clipboard can be refused outright — a denied permission, or a
      // non-secure context where the execCommand fallback is blocked too.
      // Reveal the token and hand the job to the operator; Copy stays live so
      // a retry costs one click.
      setCopied(false);
      setFailed(true);
      setRevealed(true);
    }
    // The gate on this screen exists to make sure the token was surfaced and
    // taken, not to prove the clipboard API worked. Holding the operator on
    // the last screen of the installer — no Back, no skip — over a browser
    // permission serves nobody, and the token is on screen in full by now.
    onCopied();
  };

  return (
    <SetupCard
      title="Access token"
      status={
        <>
          <span className="min-w-0 break-all font-mono">
            {revealed ? token : truncate(token)}
          </span>
          <Button
            size="icon-xs"
            variant="ghost"
            className="-ml-1 shrink-0 text-muted-foreground"
            onClick={() => setRevealed(!revealed)}
            aria-label={revealed ? "Hide the access token" : "Reveal the access token"}
          >
            {revealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          </Button>
          {copied && <span className="text-success-foreground">Copied</span>}
        </>
      }
      actions={
        <Button size="sm" onClick={() => void copy()}>
          Copy
        </Button>
      }
    >
      <p className="mt-2 text-xs text-muted-foreground">
        You'll need it to connect your phone, browser or another machine
        — it is shown only here and cannot be recovered.
      </p>

      {failed && (
        <p className="mt-1 text-xs text-destructive">
          The clipboard could not be reached. Copy the token above by hand.
        </p>
      )}
    </SetupCard>
  );
}
