import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { PullRequestInfo } from "../types.js";

const execFile = promisify(execFileCb);

// After the first ENOENT, skip all future `gh` calls for this process.
let ghAvailable: boolean | null = null;
let ghUnavailableReason = "";

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

async function gh(
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFile("gh", args, {
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

interface GhPrItem {
  number: number;
  url: string;
  state: string;
  isDraft: boolean;
  mergeable: string;
  mergeStateStatus: string;
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
  if (value === "DIRTY" || value === "BLOCKED") return "conflict";
  if (value === "UNSTABLE") return "unstable";
  return "unknown";
}

function mapChecksStatus(
  checks: GhPrItem["statusCheckRollup"],
): PullRequestInfo["checksStatus"] {
  if (!checks?.length) return "success";
  for (const c of checks) {
    if (c.conclusion === "FAILURE" || c.state === "FAILURE") return "failure";
  }
  for (const c of checks) {
    if (!c.conclusion && !c.state) return "pending";
    if (c.state === "PENDING") return "pending";
  }
  return "success";
}

export async function fetchPrForBranch(
  owner: string,
  repo: string,
  branch: string,
): Promise<{ pr: PullRequestInfo | null; error?: string }> {
  // Fast-path: gh was already found to be unavailable.
  if (ghAvailable === false) {
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
      "--json",
      "number,url,state,isDraft,mergeable,mergeStateStatus,statusCheckRollup",
      "--limit",
      "1",
    ]);

    ghAvailable = true;

    const items: GhPrItem[] = JSON.parse(stdout);
    if (!items.length) return { pr: null };

    const item = items[0];
    return {
      pr: {
        number: item.number,
        url: item.url,
        state: mapPrState(item),
        mergeable: mapMergeable(item.mergeable),
        mergeableState: mapMergeableState(item.mergeStateStatus),
        checksStatus: mapChecksStatus(item.statusCheckRollup),
      },
    };
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;

    // gh binary not found — disable permanently.
    if (error.code === "ENOENT") {
      ghAvailable = false;
      ghUnavailableReason = "gh CLI not installed";
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
}
