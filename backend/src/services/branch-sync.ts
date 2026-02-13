import { join } from "node:path";
import { git } from "../utils/git.js";
import {
  loadAllProjects,
  loadProject,
  saveProject,
  withProjectStateLock,
} from "../state/state.js";
import { workspacesDir } from "../utils/paths.js";
import type { BranchInfo, Workspace } from "../types.js";

type BranchChangeCallback = (wsId: string, info: BranchInfo) => void;

export async function getBranchName(wsPath: string): Promise<string> {
  const { stdout } = await git(["rev-parse", "--abbrev-ref", "HEAD"], wsPath);
  return stdout;
}

export class BranchSyncService {
  private interval: ReturnType<typeof setInterval> | null = null;
  private callbacks: BranchChangeCallback[] = [];
  private syncing = false;

  constructor(private readonly dataDir: string) {}

  onBranchChange(callback: BranchChangeCallback): void {
    this.callbacks.push(callback);
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
        for (const workspace of project.workspaces) {
          await this.syncWorkspace(project.id, workspace);
        }
      }
    } finally {
      this.syncing = false;
    }
  }

  private async syncWorkspace(projectId: string, workspace: Workspace): Promise<void> {
    const wsPath = join(workspacesDir(this.dataDir, projectId), workspace.name);

    let currentBranch: string;
    try {
      currentBranch = await getBranchName(wsPath);
    } catch {
      // Worktree may have been deleted or is inaccessible — skip
      return;
    }

    if (currentBranch === workspace.branch) return;

    const info: BranchInfo = {
      name: currentBranch,
      lastSyncedAt: new Date().toISOString(),
    };

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

    for (const cb of this.callbacks) {
      cb(workspace.id, info);
    }
  }

  _clearForTests(): void {
    this.stop();
    this.callbacks = [];
    this.syncing = false;
  }
}
