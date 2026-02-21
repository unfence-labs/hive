import {
  GitPullRequest,
  GitMerge,
  AlertTriangle,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePrStatus } from "@/hooks/usePrStatus";

interface PrStatusSectionProps {
  wsId?: string;
}

export function PrStatusSection({ wsId }: PrStatusSectionProps) {
  const { pr, error, loading } = usePrStatus(wsId);

  if (loading) {
    return (
      <div className="border-t border-border/50 px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <GitPullRequest className="size-3.5 shrink-0" />
          <span>Checking&hellip;</span>
        </div>
      </div>
    );
  }

  // Error state: gh unavailable / not authenticated
  if (error) {
    return (
      <div className="border-t border-border/50 px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs text-destructive">
          <AlertCircle className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">{error}</span>
        </div>
      </div>
    );
  }

  // No PR (non-GitHub repo, or GitHub repo with no PR for this branch)
  if (!pr) {
    return (
      <div className="border-t border-border/50 px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <GitPullRequest className="size-3.5 shrink-0" />
          <span>No pull request</span>
        </div>
      </div>
    );
  }

  // PR exists — determine visual state
  const isMerged = pr.state === "merged";
  const isMergeable = pr.mergeable === true || pr.mergeableState === "clean";
  const hasConflicts = pr.mergeable === false || pr.mergeableState === "conflict";

  let Icon = GitPullRequest;
  let iconClass = "text-muted-foreground";
  let textClass = "text-muted-foreground";
  let label = "Checking\u2026";

  if (isMerged) {
    Icon = GitMerge;
    iconClass = "text-purple-500";
    textClass = "text-purple-600 dark:text-purple-400";
    label = "Merged";
  } else if (isMergeable) {
    Icon = GitMerge;
    iconClass = "text-green-500";
    textClass = "text-green-600 dark:text-green-400";
    label = "Ready to merge";
  } else if (hasConflicts) {
    Icon = AlertTriangle;
    iconClass = "text-orange-500";
    textClass = "text-orange-600 dark:text-orange-400";
    label = "Has conflicts";
  }

  return (
    <div className="border-t border-border/50 px-4 py-2.5">
      <div className="flex items-center gap-2 text-xs">
        <Icon className={cn("size-3.5 shrink-0", iconClass)} />
        <span className={cn("min-w-0 truncate", textClass)}>
          PR #{pr.number} &middot; {label}
        </span>
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="size-3" />
        </a>
      </div>
    </div>
  );
}
