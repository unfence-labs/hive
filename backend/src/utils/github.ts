import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { PullRequestInfo } from "../types.js";

const execFile = promisify(execFileCb);

const GH_RETRY_COOLDOWN_MS = 60_000;
const GH_RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;
const GH_AUTH_STATUS_TIMEOUT_MS = 8_000;
const GH_RATE_LIMIT_MESSAGE = "GitHub rate limit reached — PR status refresh is paused briefly";

// After ENOENT, skip `gh` calls until cooldown expires.
let ghAvailable: boolean | null = null;
let ghUnavailableReason = "";
let ghUnavailableAt = 0;
let ghRateLimitedUntil = 0;

export type RepositoryVisibility = "public" | "private";

export interface GitHubRepository {
  owner: string;
  name: string;
  fullName: string;
  url: string;
}

export type GhClient = typeof gh;

const REPO_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;

/** Validate and normalize a GitHub repository name for `gh repo create`. */
export function validateGitHubRepositoryName(name: string): string {
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) throw new Error("Repository name is required");
  if (trimmed.length > 100) throw new Error("Repository name must be 100 characters or fewer");
  if (!REPO_NAME_RE.test(trimmed)) {
    throw new Error(
      "Repository name can only contain lowercase letters, numbers, hyphens, underscores, and dots",
    );
  }
  return trimmed;
}

function formatGhFailure(err: unknown): string {
  const error = err as NodeJS.ErrnoException & { stderr?: string };
  if (error.code === "ENOENT") {
    return "GitHub CLI not found. Install `gh` and run `gh auth login`.";
  }

  const detail = error.stderr?.trim() || error.message;
  if (detail?.includes("auth login")) {
    return "GitHub CLI is not authenticated. Run `gh auth login` and try again.";
  }
  return detail ? `GitHub CLI failed: ${detail}` : "GitHub CLI failed.";
}

function isGhRateLimitError(message: string | undefined): boolean {
  return /\brate limit\b/i.test(message ?? "");
}

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

export async function resolveGitHubCloneUrl(
  url: string,
  ghClient: GhClient = gh,
): Promise<string> {
  const repo = parseGitHubRepo(url);
  if (!repo || url.startsWith("https://")) return url;

  try {
    await ghClient(
      ["auth", "status", "--active", "--hostname", "github.com"],
      { timeoutMs: GH_AUTH_STATUS_TIMEOUT_MS },
    );
  } catch {
    return url;
  }

  return `https://github.com/${repo.owner}/${repo.repo}.git`;
}

export async function gh(
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFile("gh", args, {
    maxBuffer: 10 * 1024 * 1024,
    ...(opts.timeoutMs ? { timeout: opts.timeoutMs, killSignal: "SIGKILL" as const } : {}),
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

/** Create a GitHub repository and return its HTTPS clone URL. */
export async function createGitHubRepository(
  name: string,
  visibility: RepositoryVisibility,
  ghClient: GhClient = gh,
): Promise<GitHubRepository> {
  if (visibility !== "public" && visibility !== "private") {
    throw new Error("Invalid visibility");
  }

  const repoName = validateGitHubRepositoryName(name);

  let owner = "";
  let fullName = "";
  try {
    const { stdout: login } = await ghClient(["api", "user", "--jq", ".login"]);
    owner = login.trim();
    if (!owner) throw new Error("Unable to determine GitHub user");
    fullName = `${owner}/${repoName}`;
    await ghClient(["repo", "create", fullName, `--${visibility}`]);
  } catch (err) {
    throw new Error(formatGhFailure(err));
  }

  // The repo now exists. Any failure past this point must delete it so a
  // transient error (e.g. `repo view` replication lag) cannot orphan the remote:
  // callers create the repo before entering their own cleanup scope, so this
  // function owns cleanup of its own partial work.
  try {
    const { stdout } = await ghClient([
      "repo",
      "view",
      fullName,
      "--json",
      "url",
      "--jq",
      ".url",
    ]);
    const url = stdout.trim();
    if (!url) throw new Error("Unable to determine GitHub URL");

    return { owner, name: repoName, fullName, url };
  } catch (err) {
    await deleteGitHubRepository(fullName, ghClient).catch(() => {});
    throw new Error(formatGhFailure(err));
  }
}

/** Delete a GitHub repository by `owner/name`. Intended for cleanup after failed setup. */
export async function deleteGitHubRepository(
  fullName: string,
  ghClient: GhClient = gh,
): Promise<void> {
  await ghClient(["repo", "delete", fullName, "--yes"]);
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

  if (Date.now() < ghRateLimitedUntil) {
    return { pr: null, error: GH_RATE_LIMIT_MESSAGE };
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
    ], { timeoutMs: 8000 });

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
    if (isGhRateLimitError(stderr)) {
      ghRateLimitedUntil = Date.now() + GH_RATE_LIMIT_COOLDOWN_MS;
    }

    return { pr: null, error: `gh error: ${stderr}` };
  }
}

// ── Listing / detail helpers for the new-workspace-from picker ──────

const GH_LIST_TIMEOUT_MS = 10_000;

export interface PullRequestListEntry {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  isDraft: boolean;
  isCrossRepository: boolean;
  author?: string;
  updatedAt?: string;
}

export interface IssueListEntry {
  number: number;
  title: string;
  url: string;
  author?: string;
  updatedAt?: string;
}

export interface PullRequestDetail {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  baseRefName: string;
  isCrossRepository: boolean;
}

export interface IssueDetail {
  number: number;
  title: string;
  body: string;
  url: string;
}

async function ghJson<T>(args: string[], ghClient: GhClient): Promise<T> {
  try {
    const { stdout } = await ghClient(args, { timeoutMs: GH_LIST_TIMEOUT_MS });
    return JSON.parse(stdout) as T;
  } catch (err) {
    if (err instanceof SyntaxError) throw new Error("GitHub CLI returned unexpected output");
    throw new Error(formatGhFailure(err));
  }
}

export async function listOpenPullRequests(
  owner: string,
  repo: string,
  ghClient: GhClient = gh,
): Promise<PullRequestListEntry[]> {
  const items = await ghJson<
    Array<{ number: number; title: string; url: string; headRefName: string; isDraft: boolean; isCrossRepository: boolean; author?: { login?: string }; updatedAt?: string }>
  >([
    "pr", "list", "--repo", `${owner}/${repo}`,
    "--state", "open",
    "--json", "number,title,url,headRefName,isDraft,isCrossRepository,author,updatedAt",
    "--limit", "100",
  ], ghClient);
  return items.map((item) => ({
    number: item.number,
    title: item.title,
    url: item.url,
    headRefName: item.headRefName,
    isDraft: item.isDraft,
    isCrossRepository: item.isCrossRepository,
    author: item.author?.login,
    updatedAt: item.updatedAt,
  }));
}

export async function listOpenIssues(
  owner: string,
  repo: string,
  ghClient: GhClient = gh,
): Promise<IssueListEntry[]> {
  const items = await ghJson<
    Array<{ number: number; title: string; url: string; author?: { login?: string }; updatedAt?: string }>
  >([
    "issue", "list", "--repo", `${owner}/${repo}`,
    "--state", "open",
    "--json", "number,title,url,author,updatedAt",
    "--limit", "100",
  ], ghClient);
  return items.map((item) => ({
    number: item.number,
    title: item.title,
    url: item.url,
    author: item.author?.login,
    updatedAt: item.updatedAt,
  }));
}

export async function fetchPrDetail(
  owner: string,
  repo: string,
  number: number,
  ghClient: GhClient = gh,
): Promise<PullRequestDetail> {
  return ghJson<PullRequestDetail>([
    "pr", "view", String(number), "--repo", `${owner}/${repo}`,
    "--json", "number,title,url,headRefName,baseRefName,isCrossRepository",
  ], ghClient);
}

export async function fetchIssueDetail(
  owner: string,
  repo: string,
  number: number,
  ghClient: GhClient = gh,
): Promise<IssueDetail> {
  const item = await ghJson<{ number: number; title: string; body?: string; url: string }>([
    "issue", "view", String(number), "--repo", `${owner}/${repo}`,
    "--json", "number,title,body,url",
  ], ghClient);
  return { number: item.number, title: item.title, body: item.body ?? "", url: item.url };
}

/** Reset module-level state (for tests). */
export function _resetGhState(): void {
  ghAvailable = null;
  ghUnavailableReason = "";
  ghUnavailableAt = 0;
  ghRateLimitedUntil = 0;
}
