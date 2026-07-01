import { join } from "node:path";
import { git } from "../utils/git.js";
import {
  loadAllProjects,
  loadProject,
  saveProject,
  withProjectStateLock,
} from "../state/state.js";
import { bareRepoPath, workspacesDir, resolveDefaultBranch } from "../utils/paths.js";
import { refreshDefaultBranchFromOrigin } from "../utils/git-default-branch.js";
import { computeDiffStat } from "../workspaces/workspace-manager.js";
import { parseGitHubRepo, fetchPrForBranch } from "../utils/github.js";
import type { BranchInfo, DiffStatResponse, PrStatusResponse, Workspace } from "../types.js";

type BranchChangeCallback = (wsId: string, info: BranchInfo) => void;
type DiffStatsChangeCallback = (wsId: string, stats: DiffStatResponse) => void;
type PrStatusChangeCallback = (wsId: string, status: PrStatusResponse) => void;

const GIT_SYNC_CONCURRENCY = 6;
const DEFAULT_BRANCH_REFRESH_TTL_MS = 60_000;
const PR_SYNC_TTL_MS = 60_000;

async function withConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const executing = new Set<Promise<void>>();
  for (const item of items) {
    const p = fn(item).finally(() => executing.delete(p));
    executing.add(p);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  await Promise.allSettled([...executing]);
}

export async function getBranchName(wsPath: string): Promise<string> {
  const { stdout } = await git(["rev-parse", "--abbrev-ref", "HEAD"], wsPath);
  return stdout;
}

export class GitSyncService {
  private interval: ReturnType<typeof setInterval> | null = null;
  private branchCallbacks: BranchChangeCallback[] = [];
  private diffStatsCallbacks: DiffStatsChangeCallback[] = [];
  private prCallbacks: PrStatusChangeCallback[] = [];
  private branchInfoCache = new Map<string, string>();
  private diffStatsCache = new Map<string, string>();
  private prStatusCache = new Map<string, string>();
  private latestBranchInfo = new Map<string, BranchInfo>();
  private latestDiffStats = new Map<string, DiffStatResponse>();
  private latestPrStatus = new Map<string, PrStatusResponse>();
  private prFetchedAt = new Map<string, number>();
  private defaultBranchRefreshCache = new Map<string, { branch: string; at: number }>();
  private syncing = false;

  constructor(
    private readonly dataDir: string,
    private readonly hasHubSubscribers: (wsId: string) => boolean = () => false,
  ) {}

  onBranchChange(callback: BranchChangeCallback): void {
    this.branchCallbacks.push(callback);
  }

  onDiffStatsChange(callback: DiffStatsChangeCallback): void {
    this.diffStatsCallbacks.push(callback);
  }

  onPrStatusChange(callback: PrStatusChangeCallback): void {
    this.prCallbacks.push(callback);
  }

  getCachedBranchInfo(workspaceId: string): BranchInfo | undefined {
    return this.latestBranchInfo.get(workspaceId);
  }

  getCachedDiffStats(workspaceId: string): DiffStatResponse | undefined {
    return this.latestDiffStats.get(workspaceId);
  }

  getCachedPrStatus(workspaceId: string): PrStatusResponse | undefined {
    return this.latestPrStatus.get(workspaceId);
  }

  start(intervalMs: number): void {
    if (this.interval) return;
    this.interval = setInterval(() => {
      void this.poll();
    }, intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /** Run a single sync pass across all workspaces. Exposed for testing. */
  async poll(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const projects = await loadAllProjects(this.dataDir);
      for (const project of projects) {
        const bare = bareRepoPath(this.dataDir, project.id);
        let defaultBranch: string;
        try {
          defaultBranch = await resolveDefaultBranch(bare);
        } catch {
          // Bare repo inaccessible — skip entire project
          continue;
        }

        await this.refreshDefaultBranch(project.id, bare, defaultBranch);

        await withConcurrency(
          project.workspaces,
          GIT_SYNC_CONCURRENCY,
          (workspace) => this.syncWorkspace(project.id, workspace, bare, defaultBranch, project.url),
        );
      }
    } finally {
      this.syncing = false;
    }
  }

  private async syncWorkspace(
    projectId: string,
    workspace: Workspace,
    bare: string,
    defaultBranch: string,
    projectUrl?: string,
  ): Promise<void> {
    const wsPath = join(workspacesDir(this.dataDir, projectId), workspace.name);

    let currentBranch: string;
    try {
      currentBranch = await getBranchName(wsPath);
    } catch {
      // Worktree may have been deleted or is inaccessible — skip
      return;
    }

    // Persist branch name change
    if (currentBranch !== workspace.branch) {
      await withProjectStateLock(
        projectId,
        async () => {
          const state = await loadProject(projectId, this.dataDir);
          if (!state) return;
          const ws = state.workspaces.find((w) => w.id === workspace.id);
          if (!ws) return;
          ws.branch = currentBranch;
          await saveProject(state, this.dataDir);
        },
        this.dataDir,
      );
      this.prFetchedAt.delete(workspace.id);
    }

    // Build BranchInfo (PR status is fetched on-demand via REST)
    const info: BranchInfo = {
      name: currentBranch,
      lastSyncedAt: new Date().toISOString(),
    };
    this.latestBranchInfo.set(workspace.id, info);

    // Emit only when branch name changed (exclude lastSyncedAt)
    if (currentBranch !== this.branchInfoCache.get(workspace.id)) {
      this.branchInfoCache.set(workspace.id, currentBranch);
      for (const cb of this.branchCallbacks) {
        cb(workspace.id, info);
      }
    }

    // Diff stats change detection
    try {
      const stats = await computeDiffStat(bare, wsPath, defaultBranch, currentBranch);
      this.latestDiffStats.set(workspace.id, stats);
      const serialized = JSON.stringify(stats);
      if (serialized !== this.diffStatsCache.get(workspace.id)) {
        this.diffStatsCache.set(workspace.id, serialized);
        for (const cb of this.diffStatsCallbacks) {
          cb(workspace.id, stats);
        }
      }
    } catch {
      // Diff stat computation failed — skip silently
    }

    await this.syncPrStatus(workspace.id, projectUrl, currentBranch);
  }

  private async syncPrStatus(wsId: string, projectUrl: string | undefined, branch: string): Promise<void> {
    if (!this.hasHubSubscribers(wsId)) return;
    const ghRepo = projectUrl ? parseGitHubRepo(projectUrl) : null;
    if (!ghRepo) return;
    if (Date.now() - (this.prFetchedAt.get(wsId) ?? 0) < PR_SYNC_TTL_MS) return;
    this.prFetchedAt.set(wsId, Date.now());

    const status = await fetchPrForBranch(ghRepo.owner, ghRepo.repo, branch);
    if (status.error && this.latestPrStatus.get(wsId)?.pr) return;

    this.latestPrStatus.set(wsId, status);
    const serialized = JSON.stringify(status);
    if (serialized !== this.prStatusCache.get(wsId)) {
      this.prStatusCache.set(wsId, serialized);
      for (const cb of this.prCallbacks) {
        cb(wsId, status);
      }
    }
  }

  private async refreshDefaultBranch(
    projectId: string,
    bare: string,
    defaultBranch: string,
  ): Promise<void> {
    const now = Date.now();
    const cached = this.defaultBranchRefreshCache.get(projectId);
    if (
      cached?.branch === defaultBranch &&
      now - cached.at < DEFAULT_BRANCH_REFRESH_TTL_MS
    ) {
      return;
    }

    await refreshDefaultBranchFromOrigin(bare, defaultBranch);
    this.defaultBranchRefreshCache.set(projectId, { branch: defaultBranch, at: now });
  }

  _clearForTests(): void {
    this.stop();
    this.branchCallbacks = [];
    this.diffStatsCallbacks = [];
    this.prCallbacks = [];
    this.branchInfoCache.clear();
    this.diffStatsCache.clear();
    this.prStatusCache.clear();
    this.latestBranchInfo.clear();
    this.latestDiffStats.clear();
    this.latestPrStatus.clear();
    this.prFetchedAt.clear();
    this.defaultBranchRefreshCache.clear();
    this.syncing = false;
  }
}
