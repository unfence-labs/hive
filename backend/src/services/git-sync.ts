import { join } from "node:path";
import { git } from "../utils/git.js";
import {
  loadAllProjects,
  loadProject,
  saveProject,
  withProjectStateLock,
} from "../state/state.js";
import { bareRepoPath, workspacesDir, resolveDefaultBranch } from "../utils/paths.js";
import { computeDiffStat } from "../workspaces/workspace-manager.js";
import { parseGitHubRepo, fetchPrForBranch } from "../utils/github.js";
import type { BranchInfo, DiffStatResponse, Workspace } from "../types.js";

type BranchChangeCallback = (wsId: string, info: BranchInfo) => void;
type DiffStatsChangeCallback = (wsId: string, stats: DiffStatResponse) => void;

export async function getBranchName(wsPath: string): Promise<string> {
  const { stdout } = await git(["rev-parse", "--abbrev-ref", "HEAD"], wsPath);
  return stdout;
}

export class GitSyncService {
  private interval: ReturnType<typeof setInterval> | null = null;
  private branchCallbacks: BranchChangeCallback[] = [];
  private diffStatsCallbacks: DiffStatsChangeCallback[] = [];
  private branchInfoCache = new Map<string, string>();
  private diffStatsCache = new Map<string, string>();
  private syncing = false;

  constructor(private readonly dataDir: string) {}

  onBranchChange(callback: BranchChangeCallback): void {
    this.branchCallbacks.push(callback);
  }

  onDiffStatsChange(callback: DiffStatsChangeCallback): void {
    this.diffStatsCallbacks.push(callback);
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

        for (const workspace of project.workspaces) {
          await this.syncWorkspace(
            project.id,
            workspace,
            bare,
            defaultBranch,
            project.url,
          );
        }
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
    projectUrl: string,
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
    }

    // Build BranchInfo with PR data
    const info: BranchInfo = {
      name: currentBranch,
      lastSyncedAt: new Date().toISOString(),
    };

    const ghRepo = parseGitHubRepo(projectUrl);
    if (ghRepo) {
      const result = await fetchPrForBranch(
        ghRepo.owner,
        ghRepo.repo,
        currentBranch,
      );
      info.pr = result.pr;
      if (result.error) {
        info.prSyncError = result.error;
      }
    }

    // Emit only when branch name or PR state changed (exclude lastSyncedAt)
    const cacheKey = JSON.stringify({
      name: currentBranch,
      pr: info.pr,
      prSyncError: info.prSyncError,
    });
    if (cacheKey !== this.branchInfoCache.get(workspace.id)) {
      this.branchInfoCache.set(workspace.id, cacheKey);
      for (const cb of this.branchCallbacks) {
        cb(workspace.id, info);
      }
    }

    // Diff stats change detection
    try {
      const stats = await computeDiffStat(bare, wsPath, defaultBranch, currentBranch);
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
  }

  _clearForTests(): void {
    this.stop();
    this.branchCallbacks = [];
    this.diffStatsCallbacks = [];
    this.branchInfoCache.clear();
    this.diffStatsCache.clear();
    this.syncing = false;
  }
}
