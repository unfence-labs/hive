import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getDataDir } from "./state.js";

export interface PrSnapshot {
  number: number;
  headSha: string;
  state: string;
  commentCount: number;
  updatedAt: string;
  labels: string[];
}

export interface IssueSnapshot {
  number: number;
  state: string;
  commentCount: number;
  updatedAt: string;
  labels: string[];
}

export interface RepoPollingState {
  lastPollAt: string;
  prSnapshots: Record<number, PrSnapshot>;
  issueSnapshots: Record<number, IssueSnapshot>;
  processedEvents: string[]; // fingerprints, capped at 500 FIFO
}

export interface GitHubPollState {
  repos: Record<string, RepoPollingState>; // key = "owner/repo"
}

const MAX_PROCESSED_EVENTS = 500;
const STALE_DAYS = 30;

// Global lock for github-poll-state.json.
// All mutations must serialize on this because they load-modify-save the same file.
let pollStateLock: Promise<void> = Promise.resolve();

export async function withPollStateLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = pollStateLock;
  let release: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  pollStateLock = prev.then(() => current);

  await prev;
  try {
    return await fn();
  } finally {
    release?.();
  }
}

export function _clearPollLocksForTests(): void {
  pollStateLock = Promise.resolve();
}

function pollStateFilePath(dataDir: string): string {
  return join(dataDir, "github-poll-state.json");
}

async function atomicWrite(filePath: string, data: unknown, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `tmp.${randomUUID()}.json`);
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await rename(tmp, filePath);
}

export async function loadGitHubPollState(dataDir = getDataDir()): Promise<GitHubPollState> {
  try {
    const raw = await readFile(pollStateFilePath(dataDir), "utf-8");
    return JSON.parse(raw) as GitHubPollState;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { repos: {} };
    throw err;
  }
}

export async function saveGitHubPollState(
  state: GitHubPollState,
  dataDir = getDataDir(),
): Promise<void> {
  await atomicWrite(pollStateFilePath(dataDir), state, dataDir);
}

/**
 * Cap `processedEvents` to MAX_PROCESSED_EVENTS per repo (FIFO, keep newest).
 * Events are appended, so newest are at the end — slice from the end to keep them.
 */
export function pruneProcessedEvents(state: GitHubPollState): void {
  for (const repo of Object.values(state.repos)) {
    if (repo.processedEvents.length > MAX_PROCESSED_EVENTS) {
      repo.processedEvents = repo.processedEvents.slice(-MAX_PROCESSED_EVENTS);
    }
  }
}

/**
 * Evict closed PRs/issues where `updatedAt` is more than 30 days ago.
 */
export function pruneStaleSnapshots(state: GitHubPollState): void {
  const cutoff = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;

  for (const repo of Object.values(state.repos)) {
    for (const [key, pr] of Object.entries(repo.prSnapshots)) {
      const prState = pr.state.toUpperCase();
      if (prState === "CLOSED" || prState === "MERGED") {
        if (new Date(pr.updatedAt).getTime() < cutoff) {
          delete repo.prSnapshots[Number(key)];
        }
      }
    }

    for (const [key, issue] of Object.entries(repo.issueSnapshots)) {
      if (issue.state.toUpperCase() === "CLOSED") {
        if (new Date(issue.updatedAt).getTime() < cutoff) {
          delete repo.issueSnapshots[Number(key)];
        }
      }
    }
  }
}

/**
 * Remove repo entries that no longer have any active github_event automations.
 */
export function pruneStaleRepos(state: GitHubPollState, activeRepoKeys: Set<string>): void {
  for (const repoKey of Object.keys(state.repos)) {
    if (!activeRepoKeys.has(repoKey)) {
      delete state.repos[repoKey];
    }
  }
}
