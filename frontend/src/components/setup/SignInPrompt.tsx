import { useState, type FormEvent } from "react";
import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useClipboardCopy } from "@/hooks/useClipboardCopy";
import { openExternal } from "@/lib/open-external";
import { cn } from "@/lib/utils";

/**
 * What the operator has to do to finish a sign-in, for whichever provider.
 *
 * All three flows come down to the same two or three moves — open a page,
 * confirm a code, sometimes bring one back — so they get the same panel. Only
 * the pieces a given provider actually uses are rendered.
 */
export function SignInPrompt({
  inputId,
  verificationUri,
  userCode,
  codeLabel,
  onSubmitCode,
  onCancel,
  submitting,
  error,
}: {
  /** Unique per prompt: two providers can be mid-sign-in at the same time. */
  inputId: string;
  verificationUri: string;
  /** A code to enter at the page. Absent for flows that do not use one. */
  userCode?: string;
  /** Set when the provider hands back a code that must be pasted in here. */
  onSubmitCode?: (code: string) => void;
  codeLabel?: string;
  onCancel: () => void;
  submitting?: boolean;
  error?: string;
}) {
  const { copy, isCopied } = useClipboardCopy();
  const [pasted, setPasted] = useState("");

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const trimmed = pasted.trim();
    if (trimmed) onSubmitCode?.(trimmed);
  };

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

      {onSubmitCode ? (
        <form onSubmit={submit} className="mt-3">
          <label
            htmlFor={inputId}
            className="block text-xs font-medium text-foreground"
          >
            {codeLabel ?? "Paste the code from the browser"}
          </label>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <input
              id={inputId}
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button size="sm" type="submit" disabled={!pasted.trim() || submitting}>
              {submitting && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              Finish
            </Button>
          </div>
        </form>
      ) : (
        <p
          role="status"
          aria-live="polite"
          className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"
        >
          <Loader2 className="h-3 w-3 animate-spin" />
          Waiting for authorization…
        </p>
      )}

      {error && <p className={cn("mt-2 text-xs text-destructive")}>{error}</p>}
    </div>
  );
}
