import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createTempDir, createFixtureRepo } from "../utils/test-helpers.js";
import { createProject } from "../projects/project-manager.js";
import {
  createWorkspace,
  listWorkspaces,
  getWorkspace,
  deleteWorkspace,
  getWorkspaceDiff,
  getWorkspaceDiffStat,
  mergeWorkspace,
} from "./workspace-manager.js";
import { git } from "../utils/git.js";
import { loadProject, saveProject } from "../state/state.js";

let tempDir: string;
let dataDir: string;
let fixtureRepoUrl: string;
let projectId: string;

beforeEach(async () => {
  tempDir = await createTempDir("hive-ws-test-");
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

describe("createWorkspace", () => {
  it("creates a worktree with a city name", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    expect(ws.name).toBeTruthy();
    expect(ws.branch).toBe(`workspace/${ws.name}`);
    expect(ws.status).toBe("idle");
    expect(ws.projectId).toBe(projectId);
    expect(ws.activeSessionId).toBeUndefined();

    // Verify worktree directory exists
    const wsPath = join(dataDir, projectId, "workspaces", ws.name);
    expect(existsSync(wsPath)).toBe(true);
    expect(existsSync(join(wsPath, "README.md"))).toBe(true);
  });

  it("creates multiple workspaces with unique names", async () => {
    const ws1 = await createWorkspace(projectId, dataDir);
    const ws2 = await createWorkspace(projectId, dataDir);
    expect(ws1.name).not.toBe(ws2.name);
  });

  it("throws for non-existent project", async () => {
    await expect(createWorkspace("nonexistent", dataDir)).rejects.toThrow("not found");
  });
});

describe("listWorkspaces", () => {
  it("returns workspaces for a project", async () => {
    await createWorkspace(projectId, dataDir);
    await createWorkspace(projectId, dataDir);
    const list = await listWorkspaces(projectId, dataDir);
    expect(list).toHaveLength(2);
  });

  it("returns empty array when no workspaces", async () => {
    const list = await listWorkspaces(projectId, dataDir);
    expect(list).toEqual([]);
  });

  it("throws for non-existent project", async () => {
    await expect(listWorkspaces("nonexistent", dataDir)).rejects.toThrow("not found");
  });
});

describe("getWorkspace", () => {
  it("returns workspace details", async () => {
    const created = await createWorkspace(projectId, dataDir);
    const result = await getWorkspace(created.id, dataDir);
    expect(result).not.toBeNull();
    expect(result!.workspace.id).toBe(created.id);
    expect(result!.projectState.id).toBe(projectId);
  });

  it("returns null for non-existent workspace", async () => {
    const result = await getWorkspace("nonexistent", dataDir);
    expect(result).toBeNull();
  });
});

describe("deleteWorkspace", () => {
  it("removes worktree and updates state", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    const wsPath = join(dataDir, projectId, "workspaces", ws.name);
    expect(existsSync(wsPath)).toBe(true);

    await deleteWorkspace(ws.id, dataDir);
    expect(existsSync(wsPath)).toBe(false);

    const list = await listWorkspaces(projectId, dataDir);
    expect(list).toHaveLength(0);
  });

  it("throws for non-existent workspace", async () => {
    await expect(deleteWorkspace("nonexistent", dataDir)).rejects.toThrow("not found");
  });
});

describe("getWorkspaceDiff", () => {
  it("returns empty diff when no changes", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    const diff = await getWorkspaceDiff(ws.id, dataDir);
    expect(diff).toBe("");
  });

  it("throws for non-existent workspace", async () => {
    await expect(getWorkspaceDiff("nonexistent", dataDir)).rejects.toThrow("not found");
  });

  it("returns diff after making changes", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    const wsPath = join(dataDir, projectId, "workspaces", ws.name);

    // Make a change in the worktree
    await writeFile(join(wsPath, "new-file.txt"), "hello world\n");
    await git(["add", "."], wsPath);
    await git(["config", "user.email", "test@hive.dev"], wsPath);
    await git(["config", "user.name", "Test"], wsPath);
    await git(["commit", "-m", "add new file"], wsPath);

    const diff = await getWorkspaceDiff(ws.id, dataDir);
    expect(diff).toContain("new-file.txt");
    expect(diff).toContain("hello world");
  });
});

describe("getWorkspaceDiffStat", () => {
  it("returns empty committed and uncommitted when no changes", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    const result = await getWorkspaceDiffStat(ws.id, dataDir);
    expect(result).toEqual({ committed: [], uncommitted: [] });
  });

  it("throws for non-existent workspace", async () => {
    await expect(getWorkspaceDiffStat("nonexistent", dataDir)).rejects.toThrow("not found");
  });

  it("returns committed stats after committed changes", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    const wsPath = join(dataDir, projectId, "workspaces", ws.name);

    await writeFile(join(wsPath, "new-file.txt"), "line1\nline2\nline3\n");
    await writeFile(join(wsPath, "README.md"), "updated readme\n");
    await git(["add", "."], wsPath);
    await git(["config", "user.email", "test@hive.dev"], wsPath);
    await git(["config", "user.name", "Test"], wsPath);
    await git(["commit", "-m", "test changes"], wsPath);

    const { committed, uncommitted } = await getWorkspaceDiffStat(ws.id, dataDir);
    expect(committed.length).toBeGreaterThanOrEqual(2);
    expect(uncommitted).toEqual([]);

    const newFile = committed.find((s) => s.file === "new-file.txt");
    expect(newFile).toBeDefined();
    expect(newFile!.additions).toBe(3);
    expect(newFile!.deletions).toBe(0);
    expect(newFile!.status).toBe("added");

    const readme = committed.find((s) => s.file === "README.md");
    expect(readme).toBeDefined();
    expect(readme!.status).toBe("modified");
  });

  it("returns uncommitted stats for unstaged changes", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    const wsPath = join(dataDir, projectId, "workspaces", ws.name);

    // Only modify, don't commit
    await writeFile(join(wsPath, "README.md"), "modified but not committed\n");

    const { committed, uncommitted } = await getWorkspaceDiffStat(ws.id, dataDir);
    expect(committed).toEqual([]);
    expect(uncommitted.length).toBe(1);
    expect(uncommitted[0].file).toBe("README.md");
    expect(uncommitted[0].status).toBe("modified");
  });
});

describe("mergeWorkspace", () => {
  it("throws when workspace is busy", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    const state = await loadProject(projectId, dataDir);
    const workspace = state!.workspaces.find((w) => w.id === ws.id)!;
    workspace.status = "busy";
    workspace.activeSessionId = "some-session";
    await saveProject(state!, dataDir);

    await expect(mergeWorkspace(ws.id, dataDir)).rejects.toThrow(
      "Cannot merge while a session is active",
    );
  });

  it("merges changes into the default branch", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    const wsPath = join(dataDir, projectId, "workspaces", ws.name);

    // Make a change
    await writeFile(join(wsPath, "merged-file.txt"), "merged content\n");
    await git(["add", "."], wsPath);
    await git(["config", "user.email", "test@hive.dev"], wsPath);
    await git(["config", "user.name", "Test"], wsPath);
    await git(["commit", "-m", "add merged file"], wsPath);

    await mergeWorkspace(ws.id, dataDir);

    // Verify workspace is deleted
    const list = await listWorkspaces(projectId, dataDir);
    expect(list).toHaveLength(0);

    // Verify the change is in the default branch by creating a new worktree
    const ws2 = await createWorkspace(projectId, dataDir);
    const ws2Path = join(dataDir, projectId, "workspaces", ws2.name);
    expect(existsSync(join(ws2Path, "merged-file.txt"))).toBe(true);
  });

  it("throws for non-existent workspace", async () => {
    await expect(mergeWorkspace("nonexistent", dataDir)).rejects.toThrow("not found");
  });
});
