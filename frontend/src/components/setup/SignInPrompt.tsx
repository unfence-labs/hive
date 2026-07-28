import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useClipboardCopy } from "@/hooks/useClipboardCopy";
import { openExternal } from "@/lib/open-external";

/**
 * A device-code sign-in with room to breathe: a large code, the page to open,
 * the way out, and what is being waited for.
 *
 * Settings → Account is its one consumer, where the sign-in is the whole point
 * of the page and gets a panel of its own. Do not fold `DeviceCodeRow` into
 * this: that one is a row inside a setup card, which supplies the waiting line
 * and the Cancel from its own slots, so a card rendering this would announce
 * and offer both twice.
 */
export function SignInPrompt({
  verificationUri,
  userCode,
  onCancel,
}: {
  verificationUri: string;
  /** A code to enter at the page. Absent for flows that do not use one. */
  userCode?: string;
  onCancel: () => void;
}) {
  const { copy, isCopied } = useClipboardCopy();

  return (
    <div className="mt-3 rounded-md border border-border/60 bg-muted/20 p-4">
      {userCode && (
        <button
          type="button"
          onClick={() => void copy(userCode)}
          aria-label={isCopied(userCode) ? "Code copied" : "Copy code to clipboard"}
          className="group inline-flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-background px-4 py-2 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <code className="font-mono text-base font-bold tracking-widest">{userCode}</code>
          <span className="text-muted-foreground transition-colors group-hover:text-foreground">
            {isCopied(userCode) ? (
              <Check className="h-4 w-4 text-success-foreground" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </span>
        </button>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void openExternal(verificationUri)}>
          Open sign-in page
          <ExternalLink className="ml-1.5 h-3 w-3" />
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      <p
        role="status"
        aria-live="polite"
        className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        Waiting for authorization…
      </p>
    </div>
  );
}
