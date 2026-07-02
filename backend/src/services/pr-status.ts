import { join } from "node:path";
import { getDataDir } from "../state/state.js";
import { getWorkspace } from "../workspaces/workspace-manager.js";
import { workspacesDir } from "../utils/paths.js";
import { getBranchName } from "../utils/worktree.js";
import { fetchPrForBranch, parseGitHubRepo } from "../utils/github.js";
import type { PrStatusResponse } from "../types.js";

const PR_STATUS_TTL_MS = 15_000;

interface CachedPrStatus {
  branch: string;
  data: PrStatusResponse;
  fetchedAt: number;
  serialized: string;
}

export interface PrStatusResult {
  status: PrStatusResponse;
  changed: boolean;
}

export class PrStatusService {
  private cache = new Map<string, CachedPrStatus>();

  constructor(private readonly dataDir: string) {}

  getCachedStatus(workspaceId: string): PrStatusResponse | undefined {
    return this.cache.get(workspaceId)?.data;
  }

  async getStatus(workspaceId: string): Promise<PrStatusResponse> {
    const result = await this.refreshStatus(workspaceId);
    return result.status;
  }

  async refreshStatus(
    workspaceId: string,
    context?: { projectUrl?: string; projectId?: string; workspaceName?: string; branch?: string },
  ): Promise<PrStatusResult> {
    const cached = this.cache.get(workspaceId);
    if (!context && cached && Date.now() - cached.fetchedAt < PR_STATUS_TTL_MS) {
      return { status: cached.data, changed: false };
    }

    const loaded = context
      ? undefined
      : await getWorkspace(workspaceId, this.dataDir);

    if (!context && !loaded) {
      return this.updateCache(workspaceId, "", { pr: null, error: "Workspace not found" });
    }

    const projectUrl = context?.projectUrl ?? loaded?.projectState.url;
    const ghRepo = projectUrl ? parseGitHubRepo(projectUrl) : null;
    if (!ghRepo) {
      return this.updateCache(workspaceId, context?.branch ?? loaded?.workspace.branch ?? "", { pr: null });
    }

    const branch = context?.branch ?? await this.resolveBranch(
      loaded!.projectState.id,
      loaded!.workspace.name,
      loaded!.workspace.branch,
    );

    if (cached?.branch === branch && Date.now() - cached.fetchedAt < PR_STATUS_TTL_MS) {
      return { status: cached.data, changed: false };
    }

    const status = await fetchPrForBranch(ghRepo.owner, ghRepo.repo, branch);
    if (status.error && cached?.branch === branch && cached.data.pr) {
      this.touchCache(workspaceId);
      return { status: cached.data, changed: false };
    }

    return this.updateCache(workspaceId, branch, status);
  }

  invalidate(workspaceId: string): void {
    this.cache.delete(workspaceId);
  }

  _clearForTests(): void {
    this.cache.clear();
  }

  private async resolveBranch(projectId: string, workspaceName: string, fallback: string): Promise<string> {
    const dir = this.dataDir ?? getDataDir();
    const wsPath = join(workspacesDir(dir, projectId), workspaceName);
    try {
      return await getBranchName(wsPath);
    } catch {
      return fallback;
    }
  }

  private updateCache(workspaceId: string, branch: string, status: PrStatusResponse): PrStatusResult {
    const serialized = JSON.stringify(status);
    const previous = this.cache.get(workspaceId);
    this.cache.set(workspaceId, {
      branch,
      data: status,
      fetchedAt: Date.now(),
      serialized,
    });
    return { status, changed: previous?.serialized !== serialized || previous.branch !== branch };
  }

  private touchCache(workspaceId: string): void {
    const cached = this.cache.get(workspaceId);
    if (!cached) return;
    this.cache.set(workspaceId, { ...cached, fetchedAt: Date.now() });
  }
}
