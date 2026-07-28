import { Check, Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useClipboardCopy } from "@/hooks/useClipboardCopy";
import { openExternal } from "@/lib/open-external";

/**
 * A device-code sign-in as one row inside a setup card: the code to copy, and
 * the page to enter it on.
 *
 * It carries neither a status line nor a Cancel button, because the card
 * around it already has slots for both — the status slot says what is being
 * waited for, the actions slot offers the way out. Shared by the harness cards
 * and the GitHub card since they sit stacked on the installer's final screen,
 * where one of them signing in differently reads as a bug.
 */
export function DeviceCodeRow({
  verificationUri,
  userCode,
}: {
  verificationUri: string;
  /** A code to enter at the page. Absent for flows that do not use one. */
  userCode?: string;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {userCode && <CodeChip code={userCode} />}
      <Button size="sm" className="ml-auto" onClick={() => void openExternal(verificationUri)}>
        Open sign-in page
        <ExternalLink className="ml-1.5 h-3 w-3" />
      </Button>
    </div>
  );
}

/** The device code, copied by clicking it. */
function CodeChip({ code }: { code: string }) {
  const { copy, isCopied } = useClipboardCopy();
  return (
    <button
      type="button"
      onClick={() => void copy(code)}
      aria-label={isCopied(code) ? "Code copied" : "Copy code to clipboard"}
      className="group inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <code className="font-mono text-sm font-bold tracking-widest">{code}</code>
      {isCopied(code) ? (
        <Check className="h-3.5 w-3.5 text-success-foreground" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
      )}
    </button>
  );
}
