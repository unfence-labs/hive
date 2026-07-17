import { AlertTriangle } from "lucide-react";
import { SETUP_ERROR_HINTS } from "@hive/shared/setup-errors";
import { Button } from "@/components/ui/button";
import type { SetupError } from "@/pages/setup/machine";

interface ErrorPanelProps {
  error: SetupError;
  onRetry?: () => void;
  onDismiss?: () => void;
  retrying?: boolean;
}

/**
 * Global error panel (§9): shows the step, error code, taxonomy hint, an
 * optional log excerpt, and a Retry action.
 */
export function ErrorPanel({ error, onRetry, onDismiss, retrying }: ErrorPanelProps) {
  const hint = SETUP_ERROR_HINTS[error.code];
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-destructive">{error.code}</span>
            <span className="text-[11px] text-muted-foreground">at {error.state}</span>
          </div>
          <p className="mt-1 text-muted-foreground">{hint}</p>
          {error.logExcerpt && (
            <pre className="mt-2 max-h-32 overflow-auto rounded bg-muted/50 p-2 font-mono text-[11px] text-muted-foreground">
              {error.logExcerpt}
            </pre>
          )}
          <div className="mt-3 flex gap-2">
            {onRetry && (
              <Button size="sm" variant="destructive" onClick={onRetry} disabled={retrying}>
                {retrying ? "Retrying…" : "Retry"}
              </Button>
            )}
            {onDismiss && (
              <Button size="sm" variant="ghost" onClick={onDismiss}>
                Dismiss
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
