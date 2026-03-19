export interface GitHubEventContext {
  prNumber?: number;
  prTitle?: string;
  prBody?: string;
  prUrl?: string;
  prDiff?: string;
  prFiles?: string[];
  prAuthor?: string;
  issueNumber?: number;
  issueTitle?: string;
  issueBody?: string;
  issueUrl?: string;
  commentBody?: string;
  commentAuthor?: string;
  headSha?: string;
  previousReviewSummary?: string;
}

const MAX_DIFF_BYTES = 100 * 1024; // 100KB

export function interpolateGitHubVariables(prompt: string, ctx: GitHubEventContext): string {
  return prompt
    .replace(/\{PR_NUMBER}/g, ctx.prNumber != null ? String(ctx.prNumber) : "")
    .replace(/\{PR_TITLE}/g, ctx.prTitle ?? "")
    .replace(/\{PR_URL}/g, ctx.prUrl ?? "")
    .replace(/\{PR_DIFF}/g, truncateDiff(ctx.prDiff))
    .replace(/\{PR_DESCRIPTION}/g, ctx.prBody ?? "")
    .replace(/\{PR_AUTHOR}/g, ctx.prAuthor ?? "")
    .replace(/\{PR_FILES}/g, ctx.prFiles ? ctx.prFiles.join("\n") : "")
    .replace(/\{ISSUE_NUMBER}/g, ctx.issueNumber != null ? String(ctx.issueNumber) : "")
    .replace(/\{ISSUE_TITLE}/g, ctx.issueTitle ?? "")
    .replace(/\{ISSUE_URL}/g, ctx.issueUrl ?? "")
    .replace(/\{ISSUE_BODY}/g, ctx.issueBody ?? "")
    .replace(/\{COMMENT_BODY}/g, ctx.commentBody ?? "")
    .replace(/\{COMMENT_AUTHOR}/g, ctx.commentAuthor ?? "")
    .replace(/\{HEAD_SHA}/g, ctx.headSha ?? "")
    .replace(/\{PREVIOUS_REVIEW}/g, ctx.previousReviewSummary ?? "");
}

function truncateDiff(diff: string | undefined): string {
  if (!diff) return "";
  if (Buffer.byteLength(diff, "utf-8") <= MAX_DIFF_BYTES) return diff;
  // Truncate to fit within the byte limit
  const buf = Buffer.from(diff, "utf-8");
  return buf.subarray(0, MAX_DIFF_BYTES).toString("utf-8") + "\n…[truncated]";
}
