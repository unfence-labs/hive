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
  mergeWorkspace,
} from "./workspace-manager.js";
import { git } from "../utils/git.js";

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
    expect(ws.agents).toEqual([]);

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

describe("mergeWorkspace", () => {
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
