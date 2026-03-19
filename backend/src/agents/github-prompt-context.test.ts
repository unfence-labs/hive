import { describe, it, expect } from "vitest";
import { interpolateGitHubVariables } from "./github-prompt-context.js";
import type { GitHubEventContext } from "./github-prompt-context.js";

describe("interpolateGitHubVariables", () => {
  it("replaces all variables with provided values", () => {
    const ctx: GitHubEventContext = {
      prNumber: 42,
      prTitle: "Add login",
      prBody: "This PR adds login support.",
      prUrl: "https://github.com/org/repo/pull/42",
      prDiff: "diff --git a/file.ts b/file.ts\n+added line",
      prFiles: ["src/auth.ts", "src/login.tsx"],
      prAuthor: "alice",
      issueNumber: 7,
      issueTitle: "Fix crash",
      issueBody: "App crashes on startup.",
      issueUrl: "https://github.com/org/repo/issues/7",
      commentBody: "Looks good!",
      commentAuthor: "bob",
      headSha: "abc1234",
      previousReviewSummary: "Minor nits.",
    };

    const prompt = [
      "PR #{PR_NUMBER}: {PR_TITLE}",
      "URL: {PR_URL}",
      "Author: {PR_AUTHOR}",
      "Description: {PR_DESCRIPTION}",
      "Diff:\n{PR_DIFF}",
      "Files:\n{PR_FILES}",
      "Issue #{ISSUE_NUMBER}: {ISSUE_TITLE}",
      "Issue URL: {ISSUE_URL}",
      "Issue body: {ISSUE_BODY}",
      "Comment by {COMMENT_AUTHOR}: {COMMENT_BODY}",
      "HEAD: {HEAD_SHA}",
      "Previous review: {PREVIOUS_REVIEW}",
    ].join("\n");

    const result = interpolateGitHubVariables(prompt, ctx);

    expect(result).toContain("PR #42: Add login");
    expect(result).toContain("URL: https://github.com/org/repo/pull/42");
    expect(result).toContain("Author: alice");
    expect(result).toContain("Description: This PR adds login support.");
    expect(result).toContain("diff --git a/file.ts b/file.ts\n+added line");
    expect(result).toContain("Files:\nsrc/auth.ts\nsrc/login.tsx");
    expect(result).toContain("Issue #7: Fix crash");
    expect(result).toContain("Issue URL: https://github.com/org/repo/issues/7");
    expect(result).toContain("Issue body: App crashes on startup.");
    expect(result).toContain("Comment by bob: Looks good!");
    expect(result).toContain("HEAD: abc1234");
    expect(result).toContain("Previous review: Minor nits.");
  });

  it("replaces undefined values with empty strings", () => {
    const ctx: GitHubEventContext = {};

    const prompt =
      "PR #{PR_NUMBER}: {PR_TITLE} by {PR_AUTHOR} ({PR_URL})\n" +
      "{PR_DESCRIPTION}\n{PR_DIFF}\n{PR_FILES}\n" +
      "Issue #{ISSUE_NUMBER}: {ISSUE_TITLE} ({ISSUE_URL})\n{ISSUE_BODY}\n" +
      "{COMMENT_AUTHOR}: {COMMENT_BODY}\n" +
      "SHA: {HEAD_SHA}\nPrev: {PREVIOUS_REVIEW}";

    const result = interpolateGitHubVariables(prompt, ctx);

    expect(result).toBe(
      "PR #:  by  ()\n\n\n\n" +
      "Issue #:  ()\n\n" +
      ": \n" +
      "SHA: \nPrev: ",
    );
  });

  it("joins prFiles array with newlines", () => {
    const ctx: GitHubEventContext = {
      prFiles: ["package.json", "src/index.ts", "tests/main.test.ts"],
    };

    const result = interpolateGitHubVariables("Files:\n{PR_FILES}", ctx);

    expect(result).toBe("Files:\npackage.json\nsrc/index.ts\ntests/main.test.ts");
  });

  it("truncates prDiff to 100KB if larger", () => {
    // Create a diff larger than 100KB (use single-byte ASCII chars)
    const largeDiff = "a".repeat(200 * 1024);
    const ctx: GitHubEventContext = { prDiff: largeDiff };

    const result = interpolateGitHubVariables("{PR_DIFF}", ctx);

    // The truncated result should be at most 100KB of content + the truncation marker
    const resultBytes = Buffer.byteLength(result, "utf-8");
    // 100KB of content + "\n…[truncated]" marker
    const markerBytes = Buffer.byteLength("\n…[truncated]", "utf-8");
    expect(resultBytes).toBeLessThanOrEqual(100 * 1024 + markerBytes);
    expect(result).toContain("…[truncated]");
    expect(result).not.toBe(largeDiff);
  });

  it("does not truncate prDiff at exactly 100KB", () => {
    const exactDiff = "b".repeat(100 * 1024);
    const ctx: GitHubEventContext = { prDiff: exactDiff };

    const result = interpolateGitHubVariables("{PR_DIFF}", ctx);

    expect(result).toBe(exactDiff);
    expect(result).not.toContain("…[truncated]");
  });

  it("replaces repeated placeholders globally", () => {
    const ctx: GitHubEventContext = { prNumber: 10, prTitle: "Fix" };

    const result = interpolateGitHubVariables(
      "{PR_NUMBER}-{PR_NUMBER} {PR_TITLE}/{PR_TITLE}",
      ctx,
    );

    expect(result).toBe("10-10 Fix/Fix");
  });
});
