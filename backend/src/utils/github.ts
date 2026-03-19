import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { PullRequestInfo } from "../types.js";

const execFile = promisify(execFileCb);

const GH_RETRY_COOLDOWN_MS = 60_000;

// After ENOENT, skip `gh` calls until cooldown expires.
let ghAvailable: boolean | null = null;
let ghUnavailableReason = "";
let ghUnavailableAt = 0;

export function parseGitHubRepo(
  url: string,
): { owner: string; repo: string } | null {
  // SCP-style: git@github.com:owner/repo.git
  const scpMatch = url.match(
    /^[^@]+@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/,
  );
  if (scpMatch) return { owner: scpMatch[1], repo: scpMatch[2] };

  // URL-style: https://github.com/owner/repo.git or ssh://git@github.com/…
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") return null;
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length < 2) return null;
    return { owner: segments[0], repo: segments[1].replace(/\.git$/, "") };
  } catch {
    return null;
  }
}

export async function gh(
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFile("gh", args, {
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

/** Check whether the `gh` binary is on PATH. Caches the result. */
export async function isGhInstalled(): Promise<boolean> {
  if (ghAvailable === true) return true;
  if (ghAvailable === false && Date.now() - ghUnavailableAt < GH_RETRY_COOLDOWN_MS) {
    return false;
  }
  try {
    await execFile("gh", ["--version"]);
    ghAvailable = true;
    ghUnavailableReason = "";
    ghUnavailableAt = 0;
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      ghAvailable = false;
      ghUnavailableReason = "gh CLI not installed";
      ghUnavailableAt = Date.now();
      return false;
    }
    // gh exists but errored for some other reason
    ghAvailable = true;
    ghUnavailableReason = "";
    ghUnavailableAt = 0;
    return true;
  }
}

interface GhPrItem {
  number: number;
  url: string;
  state: string;
  isDraft: boolean;
  mergeable: string;
  mergeStateStatus: string;
  reviewDecision: string;
  statusCheckRollup: Array<{
    state?: string;
    status?: string;
    conclusion?: string;
  }>;
}

function mapPrState(item: GhPrItem): PullRequestInfo["state"] {
  if (item.state === "MERGED") return "merged";
  if (item.state === "CLOSED") return "closed";
  if (item.state === "OPEN" && item.isDraft) return "draft";
  return "open";
}

function mapMergeable(
  value: string,
): PullRequestInfo["mergeable"] {
  if (value === "MERGEABLE") return true;
  if (value === "CONFLICTING") return false;
  return null;
}

function mapMergeableState(
  value: string,
): PullRequestInfo["mergeableState"] {
  if (value === "CLEAN") return "clean";
  if (value === "DIRTY") return "conflict";
  if (value === "BLOCKED") return "blocked";
  if (value === "UNSTABLE") return "unstable";
  return "unknown";
}

function mapChecks(checks: GhPrItem["statusCheckRollup"]): {
  status: PullRequestInfo["checksStatus"];
  passed: number | null;
  total: number | null;
} {
  if (!checks?.length) return { status: "success", passed: null, total: null };

  const total = checks.length;
  let passed = 0;
  let hasFailure = false;
  let hasCancelled = false;
  let hasPending = false;

  for (const c of checks) {
    const { conclusion, state } = c;
    if (conclusion === "FAILURE" || state === "FAILURE") {
      hasFailure = true;
    } else if (
      conclusion === "CANCELLED" ||
      conclusion === "SKIPPED" ||
      conclusion === "ACTION_REQUIRED" ||
      conclusion === "TIMED_OUT" ||
      conclusion === "STALE"
    ) {
      hasCancelled = true;
    } else if (state === "PENDING" || (!conclusion && !state)) {
      hasPending = true;
    } else if (conclusion === "SUCCESS" || conclusion === "NEUTRAL") {
      passed++;
    }
  }

  let status: PullRequestInfo["checksStatus"];
  if (hasFailure) status = "failure";
  else if (hasCancelled) status = "cancelled";
  else if (hasPending) status = "pending";
  else status = "success";

  return { status, passed, total };
}

function mapReviewStatus(
  value: string,
): PullRequestInfo["reviewStatus"] {
  if (value === "APPROVED") return "approved";
  if (value === "CHANGES_REQUESTED") return "changes_requested";
  if (value === "REVIEW_REQUIRED") return "review_required";
  return null;
}

export async function fetchPrForBranch(
  owner: string,
  repo: string,
  branch: string,
): Promise<{ pr: PullRequestInfo | null; error?: string }> {
  // Fast-path: gh was recently found unavailable.
  if (ghAvailable === false && Date.now() - ghUnavailableAt < GH_RETRY_COOLDOWN_MS) {
    return { pr: null, error: ghUnavailableReason };
  }

  try {
    const { stdout } = await gh([
      "pr",
      "list",
      "--head",
      branch,
      "--repo",
      `${owner}/${repo}`,
      "--state",
      "all",
      "--json",
      "number,url,state,isDraft,mergeable,mergeStateStatus,statusCheckRollup,reviewDecision",
      "--limit",
      "1",
    ]);

    ghAvailable = true;
    ghUnavailableReason = "";
    ghUnavailableAt = 0;

    const items: GhPrItem[] = JSON.parse(stdout);
    if (!items.length) return { pr: null };

    const item = items[0];
    const checks = mapChecks(item.statusCheckRollup);
    return {
      pr: {
        number: item.number,
        url: item.url,
        state: mapPrState(item),
        mergeable: mapMergeable(item.mergeable),
        mergeableState: mapMergeableState(item.mergeStateStatus),
        checksStatus: checks.status,
        checksPassed: checks.passed,
        checksTotal: checks.total,
        reviewStatus: mapReviewStatus(item.reviewDecision),
      },
    };
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;

    // gh binary not found — disable until cooldown expires.
    if (error.code === "ENOENT") {
      ghAvailable = false;
      ghUnavailableReason = "gh CLI not installed";
      ghUnavailableAt = Date.now();
      return { pr: null, error: ghUnavailableReason };
    }

    // Auth or other errors — report but keep trying on next poll.
    const stderr =
      (error as unknown as { stderr?: string }).stderr ?? error.message;
    if (stderr?.includes("auth login")) {
      return { pr: null, error: "gh not authenticated — run `gh auth login`" };
    }

    return { pr: null, error: `gh error: ${stderr}` };
  }
}

/** Reset module-level state (for tests). */
export function _resetGhState(): void {
  ghAvailable = null;
  ghUnavailableReason = "";
  ghUnavailableAt = 0;
}

export async function postPrComment(owner: string, repo: string, prNumber: number, body: string): Promise<void> {
  const tmp = join(tmpdir(), `hive-comment-${randomUUID()}.md`);
  await writeFile(tmp, body, "utf-8");
  try {
    await gh(["pr", "comment", String(prNumber), "--repo", `${owner}/${repo}`, "--body-file", tmp]);
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

export async function postIssueComment(owner: string, repo: string, issueNumber: number, body: string): Promise<void> {
  const tmp = join(tmpdir(), `hive-comment-${randomUUID()}.md`);
  await writeFile(tmp, body, "utf-8");
  try {
    await gh(["issue", "comment", String(issueNumber), "--repo", `${owner}/${repo}`, "--body-file", tmp]);
  } finally {
    await unlink(tmp).catch(() => {});
  }
}
