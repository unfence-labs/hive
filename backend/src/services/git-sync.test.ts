import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir, createFixtureRepo } from "../utils/test-helpers.js";
import { createProject } from "../projects/project-manager.js";
import { createWorkspace } from "../workspaces/workspace-manager.js";
import { git } from "../utils/git.js";
import { loadProject } from "../state/state.js";
import { bareRepoPath, workspacesDir } from "../utils/paths.js";
import { getBranchName, GitSyncService } from "./git-sync.js";
import { fetchPrForBranch } from "../utils/github.js";
import { PrStatusService } from "./pr-status.js";
import type { BranchInfo, DiffStatResponse, PullRequestInfo } from "../types.js";

vi.mock("../utils/github.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/github.js")>();
  return {
    ...actual,
    parseGitHubRepo: vi.fn(() => ({ owner: "o", repo: "r" })),
    fetchPrForBranch: vi.fn(async () => ({ pr: null })),
  };
});

function makePr(number: number): PullRequestInfo {
  return {
    number,
    url: `https://github.com/o/r/pull/${number}`,
    state: "open",
    mergeable: null,
    mergeableState: "unknown",
    checksStatus: "success",
    checksPassed: null,
    checksTotal: null,
    reviewStatus: null,
  };
}

let tempDir: string;
let dataDir: string;
let fixtureRepoUrl: string;
let projectId: string;

async function pushRemoteMainFile(
  cloneName: string,
  fileName: string,
  content: string,
): Promise<void> {
  const pushClone = join(tempDir, cloneName);
  await git(["clone", fixtureRepoUrl, pushClone]);
  await git(["config", "user.email", "test@hive.dev"], pushClone);
  await git(["config", "user.name", "Test"], pushClone);
  await writeFile(join(pushClone, fileName), content);
  await git(["add", "."], pushClone);
  await git(["commit", "-m", `add ${fileName}`], pushClone);
  await git(["push", "origin", "main"], pushClone);
}

beforeEach(async () => {
  tempDir = await createTempDir("hive-git-sync-test-");
  dataDir = join(tempDir, "data");
  const fixtureDir = join(tempDir, "fixtures");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dataDir, { recursive: true });
  await mkdir(fixtureDir, { recursive: true });
  fixtureRepoUrl = await createFixtureRepo(fixtureDir);

  const project = await createProject(fixtureRepoUrl, dataDir);
  projectId = project.id;
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("getBranchName", () => {
  it("returns correct branch from a real worktree", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    const wsPath = join(workspacesDir(dataDir, projectId), ws.name);

    const branchName = await getBranchName(wsPath);
    expect(branchName).toBe(`workspace/${ws.name}`);
  });

  it("throws on missing worktree", async () => {
    const nonExistentPath = join(tempDir, "nonexistent-worktree");
    await expect(getBranchName(nonExistentPath)).rejects.toThrow();
  });
});

describe("GitSyncService", () => {
  let service: GitSyncService;

  beforeEach(() => {
    service = new GitSyncService(dataDir);
  });

  afterEach(() => {
    service._clearForTests();
  });

  it("detects branch rename and updates state", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    const wsPath = join(workspacesDir(dataDir, projectId), ws.name);

    const newBranchName = "renamed-branch";
    await git(["branch", "-m", newBranchName], wsPath);

    await service.poll();

    const state = await loadProject(projectId, dataDir);
    const workspace = state!.workspaces.find((w) => w.id === ws.id);
    expect(workspace!.branch).toBe(newBranchName);
  });

  it("emits onBranchChange callback with correct BranchInfo", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    const wsPath = join(workspacesDir(dataDir, projectId), ws.name);

    let callbackWsId: string | undefined;
    let callbackInfo: BranchInfo | undefined;

    service.onBranchChange((wsId, info) => {
      callbackWsId = wsId;
      callbackInfo = info;
    });

    const newBranchName = "feature-branch";
    await git(["branch", "-m", newBranchName], wsPath);

    await service.poll();

    expect(callbackWsId).toBe(ws.id);
    expect(callbackInfo).toBeDefined();
    expect(callbackInfo!.name).toBe(newBranchName);
    expect(callbackInfo!.lastSyncedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("emits onPrStatusChange only for workspaces with PR status interest", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    const interested = new Set<string>();
    const prStatus = new PrStatusService(dataDir);
    const prService = new GitSyncService(dataDir, prStatus, (id) => interested.has(id));
    const events: string[] = [];
    prService.onPrStatusChange((wsId) => events.push(wsId));

    await prService.poll();
    expect(events).toEqual([]);

    interested.add(ws.id);
    await prService.poll();
    expect(events).toEqual([ws.id]);

    prService._clearForTests();
  });

  it("clears cached PR status for a workspace when its branch changes", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    const wsPath = join(workspacesDir(dataDir, projectId), ws.name);
    const prStatus = new PrStatusService(dataDir);
    const prService = new GitSyncService(dataDir, prStatus, (id) => id === ws.id);

    vi.mocked(fetchPrForBranch).mockResolvedValueOnce({ pr: makePr(42) });
    await prService.poll();
    expect(prService.getCachedPrStatus(ws.id)?.pr?.number).toBe(42);

    await git(["branch", "-m", "renamed-for-pr-test"], wsPath);

    vi.mocked(fetchPrForBranch).mockResolvedValueOnce({ pr: null, error: "gh unavailable" });
    await prService.poll();

    const cached = prService.getCachedPrStatus(ws.id);
    expect(cached?.pr?.number).not.toBe(42);
    expect(cached).toEqual({ pr: null, error: "gh unavailable" });

    prService._clearForTests();
  });

  it("does NOT emit callback when branch has not changed", async () => {
    await createWorkspace(projectId, dataDir);

    let callCount = 0;
    service.onBranchChange(() => {
      callCount++;
    });

    // First poll fills the cache and emits once
    await service.poll();
    expect(callCount).toBe(1);

    // Second poll — nothing changed, no emission
    await service.poll();
    expect(callCount).toBe(1);
  });

  it("handles deleted worktree without crashing", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    const wsPath = join(workspacesDir(dataDir, projectId), ws.name);

    await rm(wsPath, { recursive: true, force: true });

    await expect(service.poll()).resolves.not.toThrow();
  });

  it("start and stop lifecycle manages interval correctly", () => {
    const setIntervalSpy = vi.spyOn(global, "setInterval");
    const clearIntervalSpy = vi.spyOn(global, "clearInterval");

    service.start(5000);

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000);

    // start again should be a no-op
    service.start(5000);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    service.stop();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

    // stop again should be a no-op
    service.stop();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it("handles multiple workspaces and only triggers callback for changed ones", async () => {
    const ws1 = await createWorkspace(projectId, dataDir);
    const ws2 = await createWorkspace(projectId, dataDir);
    const ws1Path = join(workspacesDir(dataDir, projectId), ws1.name);

    // Baseline poll to fill caches
    await service.poll();

    const changedWorkspaces: string[] = [];
    service.onBranchChange((wsId) => {
      changedWorkspaces.push(wsId);
    });

    await git(["branch", "-m", "only-ws1-changed"], ws1Path);

    await service.poll();

    expect(changedWorkspaces).toHaveLength(1);
    expect(changedWorkspaces[0]).toBe(ws1.id);

    const state = await loadProject(projectId, dataDir);
    const workspace1 = state!.workspaces.find((w) => w.id === ws1.id);
    const workspace2 = state!.workspaces.find((w) => w.id === ws2.id);

    expect(workspace1!.branch).toBe("only-ws1-changed");
    expect(workspace2!.branch).toBe(`workspace/${ws2.name}`);
  });

  // ── Diff stats syncing ──────────────────────────────────────────────

  it("emits onDiffStatsChange when uncommitted files change", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    const wsPath = join(workspacesDir(dataDir, projectId), ws.name);

    let callbackStats: DiffStatResponse | undefined;
    service.onDiffStatsChange((_wsId, stats) => {
      callbackStats = stats;
    });

    // First poll — baseline (clean worktree, no diff)
    await service.poll();

    // Create an untracked file — should be detected without `git add`
    callbackStats = undefined;
    await writeFile(join(wsPath, "new-file.txt"), "hello\n");

    await service.poll();

    expect(callbackStats).toBeDefined();
    expect(callbackStats!.uncommitted.length).toBeGreaterThan(0);
    const newFile = callbackStats!.uncommitted.find((f) => f.file === "new-file.txt");
    expect(newFile).toBeDefined();
  });

  it("does NOT emit onDiffStatsChange on second poll with no changes", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    const wsPath = join(workspacesDir(dataDir, projectId), ws.name);

    // Create an uncommitted change
    await writeFile(join(wsPath, "stable-file.txt"), "stable\n");

    let callCount = 0;
    service.onDiffStatsChange(() => {
      callCount++;
    });

    await service.poll();
    expect(callCount).toBe(1);

    // Second poll — nothing changed
    await service.poll();
    expect(callCount).toBe(1);
  });

  it("handles deleted worktree for diff stats without crashing", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    const wsPath = join(workspacesDir(dataDir, projectId), ws.name);

    // First poll to populate cache
    await service.poll();

    // Delete worktree
    await rm(wsPath, { recursive: true, force: true });

    await expect(service.poll()).resolves.not.toThrow();
  });

  it("keeps latest branch and diff stats snapshots for bootstrap", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    const wsPath = join(workspacesDir(dataDir, projectId), ws.name);

    await service.poll();

    const initialBranch = service.getCachedBranchInfo(ws.id);
    const initialDiff = service.getCachedDiffStats(ws.id);
    expect(initialBranch?.name).toBe(`workspace/${ws.name}`);
    expect(initialDiff).toEqual({ committed: [], uncommitted: [] });

    await writeFile(join(wsPath, "bootstrap.txt"), "hello\n");
    await service.poll();

    const updatedDiff = service.getCachedDiffStats(ws.id);
    expect(updatedDiff?.uncommitted.some((f) => f.file === "bootstrap.txt")).toBe(true);
  });

  it("refreshes the default branch before broadcasting diff stats", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    const wsPath = join(workspacesDir(dataDir, projectId), ws.name);
    const bare = bareRepoPath(dataDir, projectId);

    await pushRemoteMainFile("push-clone-stale-main", "main-only.txt", "from main\n");

    await git(["fetch", "origin", "main:refs/hive-test/main-update"], bare);
    await git(["merge", "--ff-only", "refs/hive-test/main-update"], wsPath);

    await writeFile(join(wsPath, "branch-only.txt"), "from branch\n");
    await git(["add", "."], wsPath);
    await git(["config", "user.email", "test@hive.dev"], wsPath);
    await git(["config", "user.name", "Test"], wsPath);
    await git(["commit", "-m", "add branch-only file"], wsPath);

    await service.poll();

    const committed = service.getCachedDiffStats(ws.id)?.committed ?? [];
    const files = committed.map((s) => s.file);
    expect(files).toContain("branch-only.txt");
    expect(files).not.toContain("main-only.txt");
  });

  it("returns undefined from getCachedBranchInfo/getCachedDiffStats for unknown workspace", async () => {
    await createWorkspace(projectId, dataDir);
    await service.poll();

    expect(service.getCachedBranchInfo("nonexistent-id")).toBeUndefined();
    expect(service.getCachedDiffStats("nonexistent-id")).toBeUndefined();
  });

  it("_clearForTests removes cached branch info and diff stats", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    await service.poll();

    expect(service.getCachedBranchInfo(ws.id)).toBeDefined();
    expect(service.getCachedDiffStats(ws.id)).toBeDefined();

    service._clearForTests();

    expect(service.getCachedBranchInfo(ws.id)).toBeUndefined();
    expect(service.getCachedDiffStats(ws.id)).toBeUndefined();
  });

  it("syncs all workspaces correctly with concurrent execution", async () => {
    const ws1 = await createWorkspace(projectId, dataDir);
    const ws2 = await createWorkspace(projectId, dataDir);
    const ws3 = await createWorkspace(projectId, dataDir);
    const ws1Path = join(workspacesDir(dataDir, projectId), ws1.name);
    const ws3Path = join(workspacesDir(dataDir, projectId), ws3.name);

    // Rename branches on ws1 and ws3 to verify all workspaces are processed
    await git(["branch", "-m", "branch-one"], ws1Path);
    await git(["branch", "-m", "branch-three"], ws3Path);

    await service.poll();

    // All 3 workspaces were synced with correct data
    expect(service.getCachedBranchInfo(ws1.id)?.name).toBe("branch-one");
    expect(service.getCachedBranchInfo(ws2.id)?.name).toBe(`workspace/${ws2.name}`);
    expect(service.getCachedBranchInfo(ws3.id)?.name).toBe("branch-three");

    // Branch renames persisted to disk
    const state = await loadProject(projectId, dataDir);
    expect(state!.workspaces.find((w) => w.id === ws1.id)!.branch).toBe("branch-one");
    expect(state!.workspaces.find((w) => w.id === ws3.id)!.branch).toBe("branch-three");
  });

  it("ignores a concurrent poll call while one sync cycle is already running", async () => {
    await createWorkspace(projectId, dataDir);

    const serviceWithPrivateSync = service as unknown as {
      syncWorkspace: (...args: unknown[]) => Promise<void>;
    };
    const originalSyncWorkspace = serviceWithPrivateSync.syncWorkspace.bind(serviceWithPrivateSync);
    let releaseFirstSync: (() => void) | undefined;
    const firstSyncGate = new Promise<void>((resolve) => {
      releaseFirstSync = resolve;
    });

    const syncWorkspaceSpy = vi.spyOn(serviceWithPrivateSync, "syncWorkspace");
    syncWorkspaceSpy.mockImplementationOnce(async (...args: unknown[]) => {
      await firstSyncGate;
      return originalSyncWorkspace(...args);
    });

    const firstPoll = service.poll();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const secondPoll = service.poll();

    // Should resolve immediately because `syncing` is already true.
    await expect(secondPoll).resolves.toBeUndefined();

    releaseFirstSync?.();
    await firstPoll;

    expect(syncWorkspaceSpy).toHaveBeenCalledTimes(1);
  });

  it("continues syncing healthy workspaces when one worktree is missing", async () => {
    const ws1 = await createWorkspace(projectId, dataDir);
    const ws2 = await createWorkspace(projectId, dataDir);
    const ws3 = await createWorkspace(projectId, dataDir);
    const ws2Path = join(workspacesDir(dataDir, projectId), ws2.name);
    const ws3Path = join(workspacesDir(dataDir, projectId), ws3.name);

    await rm(ws2Path, { recursive: true, force: true });
    await git(["branch", "-m", "healthy-branch"], ws3Path);

    await expect(service.poll()).resolves.not.toThrow();

    expect(service.getCachedBranchInfo(ws1.id)?.name).toBe(`workspace/${ws1.name}`);
    expect(service.getCachedBranchInfo(ws2.id)).toBeUndefined();
    expect(service.getCachedBranchInfo(ws3.id)?.name).toBe("healthy-branch");

    const state = await loadProject(projectId, dataDir);
    expect(state!.workspaces.find((w) => w.id === ws3.id)!.branch).toBe("healthy-branch");
  });

  it("maintains independent caches per workspace", async () => {
    const ws1 = await createWorkspace(projectId, dataDir);
    const ws2 = await createWorkspace(projectId, dataDir);
    const ws2Path = join(workspacesDir(dataDir, projectId), ws2.name);

    await service.poll();

    // Both have clean diff stats initially
    expect(service.getCachedDiffStats(ws1.id)).toEqual({ committed: [], uncommitted: [] });
    expect(service.getCachedDiffStats(ws2.id)).toEqual({ committed: [], uncommitted: [] });

    // Only modify ws2
    await writeFile(join(ws2Path, "ws2-only.txt"), "change\n");
    await service.poll();

    // ws1 unchanged, ws2 has the new file
    const ws1Diff = service.getCachedDiffStats(ws1.id);
    const ws2Diff = service.getCachedDiffStats(ws2.id);
    expect(ws1Diff?.uncommitted).toEqual([]);
    expect(ws2Diff?.uncommitted.some((f) => f.file === "ws2-only.txt")).toBe(true);

    // Both have their own branch info
    expect(service.getCachedBranchInfo(ws1.id)?.name).toBe(`workspace/${ws1.name}`);
    expect(service.getCachedBranchInfo(ws2.id)?.name).toBe(`workspace/${ws2.name}`);
  });
});
