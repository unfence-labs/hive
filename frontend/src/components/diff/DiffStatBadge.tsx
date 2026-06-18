import { cn } from "@/lib/utils";

interface DiffStatBadgeProps {
  additions: number;
  deletions: number;
  className?: string;
}

/** Compact `+X -Y` churn badge (success additions / destructive deletions). Each side is
 *  hidden when zero; renders nothing when there is no change at all. */
export function DiffStatBadge({ additions, deletions, className }: DiffStatBadgeProps) {
  if (additions === 0 && deletions === 0) return null;

  return (
    <span className={cn("flex shrink-0 items-center gap-1 font-mono tabular-nums", className)}>
      {additions > 0 && <span className="text-success-foreground">+{additions}</span>}
      {deletions > 0 && <span className="text-destructive">-{deletions}</span>}
    </span>
  );
}
