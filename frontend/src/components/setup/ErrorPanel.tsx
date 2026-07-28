import { AlertTriangle } from "lucide-react";

/**
 * The one shape every setup card reports a problem in: what failed, why, and
 * the command output when there is some.
 */
export function ErrorPanel({
  title,
  detail,
  output,
}: {
  title: string;
  detail?: string;
  output?: string;
}) {
  return (
    <div role="alert" className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
      <p className="flex items-center gap-2 text-xs font-medium text-destructive">
        <AlertTriangle className="h-3.5 w-3.5" />
        {title}
      </p>
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
      {output && (
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-2 font-mono text-[11px] text-muted-foreground">
          {output}
        </pre>
      )}
    </div>
  );
}
