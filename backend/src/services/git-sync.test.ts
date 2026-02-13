import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir, createFixtureRepo } from "../utils/test-helpers.js";
import { createProject } from "../projects/project-manager.js";
import { createWorkspace } from "../workspaces/workspace-manager.js";
import { git } from "../utils/git.js";
import { loadProject } from "../state/state.js";
import { workspacesDir } from "../utils/paths.js";
import { getBranchName, GitSyncService } from "./git-sync.js";
import type { BranchInfo, DiffStatResponse } from "../types.js";

let tempDir: string;
let dataDir: string;
let fixtureRepoUrl: string;
let projectId: string;

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

  it("does NOT emit callback when branch has not changed", async () => {
    await createWorkspace(projectId, dataDir);

    let callCount = 0;
    service.onBranchChange(() => {
      callCount++;
    });

    await service.poll();
    await service.poll();

    expect(callCount).toBe(0);
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

    // Create an uncommitted change
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
});
