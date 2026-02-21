import type { LucideIcon } from "lucide-react";
import {
  GitPullRequest,
  GitPullRequestClosed,
  GitMerge,
  AlertTriangle,
  AlertCircle,
  ExternalLink,
  XCircle,
  Ban,
  Clock,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePrStatus } from "@/hooks/usePrStatus";
import type { PullRequestInfo } from "@/types";

interface PrStatusSectionProps {
  wsId?: string;
}

function computePrDisplay(pr: PullRequestInfo): {
  Icon: LucideIcon;
  iconClass: string;
  textClass: string;
  label: string;
} {
  const checksLabel = (verb: string) => {
    if (pr.checksPassed != null && pr.checksTotal != null) {
      return `${verb} (${pr.checksPassed}/${pr.checksTotal})`;
    }
    return verb;
  };

  // 1. Merged
  if (pr.state === "merged")
    return {
      Icon: GitMerge,
      iconClass: "text-purple-500",
      textClass: "text-purple-600 dark:text-purple-400",
      label: "Merged",
    };

  // 2. Closed
  if (pr.state === "closed")
    return {
      Icon: GitPullRequestClosed,
      iconClass: "text-muted-foreground",
      textClass: "text-muted-foreground",
      label: "Closed",
    };

  // 3. Draft
  if (pr.state === "draft")
    return {
      Icon: GitPullRequest,
      iconClass: "text-muted-foreground",
      textClass: "text-muted-foreground",
      label: "Draft",
    };

  // 4. Conflicts
  if (pr.mergeable === false || pr.mergeableState === "conflict")
    return {
      Icon: AlertTriangle,
      iconClass: "text-orange-500",
      textClass: "text-orange-600 dark:text-orange-400",
      label: "Has conflicts",
    };

  // 5. Checks failing
  if (pr.checksStatus === "failure")
    return {
      Icon: XCircle,
      iconClass: "text-red-500",
      textClass: "text-red-600 dark:text-red-400",
      label: checksLabel("Checks failing"),
    };

  // 6. Checks cancelled
  if (pr.checksStatus === "cancelled")
    return {
      Icon: Ban,
      iconClass: "text-orange-500",
      textClass: "text-orange-600 dark:text-orange-400",
      label: "Checks cancelled",
    };

  // 7. Checks pending
  if (pr.checksStatus === "pending")
    return {
      Icon: Clock,
      iconClass: "text-yellow-500",
      textClass: "text-yellow-600 dark:text-yellow-400",
      label: checksLabel("Checks running"),
    };

  // 8. Changes requested
  if (pr.reviewStatus === "changes_requested")
    return {
      Icon: AlertTriangle,
      iconClass: "text-orange-500",
      textClass: "text-orange-600 dark:text-orange-400",
      label: "Changes requested",
    };

  // 9. Blocked (branch protection)
  if (pr.mergeableState === "blocked")
    return {
      Icon: Ban,
      iconClass: "text-orange-500",
      textClass: "text-orange-600 dark:text-orange-400",
      label: "Blocked",
    };

  // 10. Unstable (non-required checks failing)
  if (pr.mergeableState === "unstable")
    return {
      Icon: AlertTriangle,
      iconClass: "text-yellow-500",
      textClass: "text-yellow-600 dark:text-yellow-400",
      label: "Unstable",
    };

  // 11. Review needed
  if (pr.reviewStatus === "review_required")
    return {
      Icon: Eye,
      iconClass: "text-blue-500",
      textClass: "text-blue-600 dark:text-blue-400",
      label: "Review needed",
    };

  // 12. Ready to merge
  if (pr.mergeable === true || pr.mergeableState === "clean")
    return {
      Icon: GitMerge,
      iconClass: "text-green-500",
      textClass: "text-green-600 dark:text-green-400",
      label: "Ready to merge",
    };

  // 13. Fallback: Open
  return {
    Icon: GitPullRequest,
    iconClass: "text-blue-500",
    textClass: "text-blue-600 dark:text-blue-400",
    label: "Open",
  };
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

  const { Icon, iconClass, textClass, label } = computePrDisplay(pr);

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
