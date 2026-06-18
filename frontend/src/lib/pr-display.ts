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
  /** Tailwind text color class from the dedicated PR-status palette (see index.css). */
  colorClass: string;
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
    return { Icon: GitMerge, colorClass: "text-pr-merged", label: "Merged" };

  // 2. Closed
  if (pr.state === "closed")
    return { Icon: GitPullRequestClosed, colorClass: "text-pr-closed", label: "Closed" };

  // 3. Draft
  if (pr.state === "draft")
    return { Icon: GitPullRequest, colorClass: "text-pr-draft", label: "Draft" };

  // 4. Conflicts
  if (pr.mergeable === false || pr.mergeableState === "conflict")
    return { Icon: AlertTriangle, colorClass: "text-pr-closed", label: "Has conflicts" };

  // 5. Checks failing
  if (pr.checksStatus === "failure")
    return { Icon: XCircle, colorClass: "text-pr-closed", label: checksLabel("Checks failing") };

  // 6. Checks cancelled
  if (pr.checksStatus === "cancelled")
    return { Icon: Ban, colorClass: "text-pr-draft", label: "Checks cancelled" };

  // 7. Checks pending
  if (pr.checksStatus === "pending")
    return { Icon: Clock, colorClass: "text-pr-attention", label: checksLabel("Checks running") };

  // 8. Changes requested
  if (pr.reviewStatus === "changes_requested")
    return { Icon: AlertTriangle, colorClass: "text-pr-closed", label: "Changes requested" };

  // 9. Blocked (branch protection)
  if (pr.mergeableState === "blocked")
    return { Icon: Ban, colorClass: "text-pr-attention", label: "Blocked" };

  // 10. Unstable (non-required checks failing)
  if (pr.mergeableState === "unstable")
    return { Icon: AlertTriangle, colorClass: "text-pr-attention", label: "Unstable" };

  // 11. Review needed
  if (pr.reviewStatus === "review_required")
    return { Icon: Eye, colorClass: "text-pr-attention", label: "Review needed" };

  // 12. Ready to merge
  if (pr.mergeable === true || pr.mergeableState === "clean")
    return { Icon: GitMerge, colorClass: "text-pr-open", label: "Ready to merge" };

  // 13. Fallback: Open
  return { Icon: GitPullRequest, colorClass: "text-pr-open", label: "Open" };
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
