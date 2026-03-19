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
  const vars: Record<string, string> = {
    PR_NUMBER: ctx.prNumber != null ? String(ctx.prNumber) : "",
    PR_TITLE: ctx.prTitle ?? "",
    PR_URL: ctx.prUrl ?? "",
    PR_DIFF: truncateDiff(ctx.prDiff),
    PR_DESCRIPTION: ctx.prBody ?? "",
    PR_AUTHOR: ctx.prAuthor ?? "",
    PR_FILES: ctx.prFiles ? ctx.prFiles.join("\n") : "",
    ISSUE_NUMBER: ctx.issueNumber != null ? String(ctx.issueNumber) : "",
    ISSUE_TITLE: ctx.issueTitle ?? "",
    ISSUE_URL: ctx.issueUrl ?? "",
    ISSUE_BODY: ctx.issueBody ?? "",
    COMMENT_BODY: ctx.commentBody ?? "",
    COMMENT_AUTHOR: ctx.commentAuthor ?? "",
    HEAD_SHA: ctx.headSha ?? "",
    PREVIOUS_REVIEW: ctx.previousReviewSummary ?? "",
  };

  const pattern = new RegExp(`\\{(${Object.keys(vars).join("|")})\\}`, "g");
  return prompt.replace(pattern, (_, key: string) => vars[key] ?? "");
}

function truncateDiff(diff: string | undefined): string {
  if (!diff) return "";
  if (Buffer.byteLength(diff, "utf-8") <= MAX_DIFF_BYTES) return diff;
  // Truncate to fit within the byte limit
  const buf = Buffer.from(diff, "utf-8");
  return buf.subarray(0, MAX_DIFF_BYTES).toString("utf-8") + "\n…[truncated]";
}
