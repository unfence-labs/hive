import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useClipboardCopy } from "@/hooks/useClipboardCopy";
import { openExternal } from "@/lib/open-external";

/**
 * A device-code sign-in: copy the code, open the page, wait. GitHub's flow in
 * Settings → Account is the one consumer; the agent harnesses render their own
 * inline prompt in ToolsPanel.
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
