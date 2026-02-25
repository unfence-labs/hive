import type { LucideIcon } from "lucide-react";
import {
  GitPullRequest,
  GitPullRequestClosed,
  GitMerge,
  AlertTriangle,
  XCircle,
  Ban,
  Clock,
  Eye,
} from "lucide-react";
import type { PullRequestInfo } from "@/types";

export interface PrDisplayInfo {
  Icon: LucideIcon;
  iconClass: string;
  textClass: string;
  label: string;
}

export function computePrDisplay(pr: PullRequestInfo): PrDisplayInfo {
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

const shortLabels: Record<string, string> = {
  "Ready to merge": "Ready",
  "Has conflicts": "Conflicts",
  "Review needed": "Review",
  "Checks failing": "Failing",
  "Checks running": "Running",
  "Changes requested": "Changes req.",
  "Checks cancelled": "Cancelled",
};

export function computePrDisplayCompact(pr: PullRequestInfo): PrDisplayInfo {
  const full = computePrDisplay(pr);
  return {
    ...full,
    label: shortLabels[full.label] ?? full.label,
  };
}
