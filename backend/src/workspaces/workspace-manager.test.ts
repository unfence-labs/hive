import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, writeFile, mkdir } from "node:fs/promises";
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

  it("includes untracked files as synthetic diff patches", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    const wsPath = join(dataDir, projectId, "workspaces", ws.name);

    // Create an untracked file (not git-added)
    await writeFile(join(wsPath, "untracked.txt"), "line1\nline2\n");

    const diff = await getWorkspaceDiff(ws.id, dataDir);

    expect(diff).toContain("diff --git a/untracked.txt b/untracked.txt");
    expect(diff).toContain("new file mode 100644");
    expect(diff).toContain("--- /dev/null");
    expect(diff).toContain("+++ b/untracked.txt");
    expect(diff).toContain("+line1");
    expect(diff).toContain("+line2");
  });

  it("skips binary untracked files (containing null bytes)", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    const wsPath = join(dataDir, projectId, "workspaces", ws.name);

    // Create a binary file (has null byte)
    await writeFile(join(wsPath, "binary.bin"), Buffer.from([0x48, 0x00, 0x49]));
    // Also create a text file to verify partial inclusion
    await writeFile(join(wsPath, "text.txt"), "visible\n");

    const diff = await getWorkspaceDiff(ws.id, dataDir);

    expect(diff).not.toContain("binary.bin");
    expect(diff).toContain("text.txt");
  });

  it("includes untracked files in subdirectories", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    const wsPath = join(dataDir, projectId, "workspaces", ws.name);

    await mkdir(join(wsPath, "subdir"), { recursive: true });
    await writeFile(join(wsPath, "subdir", "nested.txt"), "nested content\n");

    const diff = await getWorkspaceDiff(ws.id, dataDir);

    expect(diff).toContain("subdir/nested.txt");
    expect(diff).toContain("+nested content");
  });

  it("combines committed, uncommitted, and untracked diffs", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    const wsPath = join(dataDir, projectId, "workspaces", ws.name);

    // Committed change
    await writeFile(join(wsPath, "committed.txt"), "committed\n");
    await git(["add", "."], wsPath);
    await git(["config", "user.email", "test@hive.dev"], wsPath);
    await git(["config", "user.name", "Test"], wsPath);
    await git(["commit", "-m", "committed file"], wsPath);

    // Uncommitted (tracked) change
    await writeFile(join(wsPath, "README.md"), "modified readme\n");

    // Untracked file
    await writeFile(join(wsPath, "brand-new.txt"), "untracked\n");

    const diff = await getWorkspaceDiff(ws.id, dataDir);

    expect(diff).toContain("committed.txt");
    expect(diff).toContain("README.md");
    expect(diff).toContain("brand-new.txt");
  });

  it("handles file without trailing newline in synthetic diff", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    const wsPath = join(dataDir, projectId, "workspaces", ws.name);

    await writeFile(join(wsPath, "no-newline.txt"), "no trailing newline");

    const diff = await getWorkspaceDiff(ws.id, dataDir);

    expect(diff).toContain("+no trailing newline");
    expect(diff).toContain("@@ -0,0 +1,1 @@");
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

  it("returns renamed file metadata for committed renames", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    const wsPath = join(dataDir, projectId, "workspaces", ws.name);

    await git(["mv", "README.md", "README-renamed.md"], wsPath);
    await git(["config", "user.email", "test@hive.dev"], wsPath);
    await git(["config", "user.name", "Test"], wsPath);
    await git(["commit", "-m", "rename readme"], wsPath);

    const { committed, uncommitted } = await getWorkspaceDiffStat(ws.id, dataDir);
    expect(uncommitted).toEqual([]);

    const renamed = committed.find((s) => s.file === "README-renamed.md");
    expect(renamed).toBeDefined();
    expect(renamed!.status).toBe("renamed");
    expect(renamed!.renamedFrom).toBe("README.md");
    expect(renamed!.additions).toBe(0);
    expect(renamed!.deletions).toBe(0);
  });

  it("returns renamed file metadata for uncommitted renames", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    const wsPath = join(dataDir, projectId, "workspaces", ws.name);

    await git(["mv", "README.md", "README-renamed.md"], wsPath);

    const { committed, uncommitted } = await getWorkspaceDiffStat(ws.id, dataDir);
    expect(committed).toEqual([]);

    const renamed = uncommitted.find((s) => s.file === "README-renamed.md");
    expect(renamed).toBeDefined();
    expect(renamed!.status).toBe("renamed");
    expect(renamed!.renamedFrom).toBe("README.md");
  });

  it("separates committed and uncommitted stats in the same workspace", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    const wsPath = join(dataDir, projectId, "workspaces", ws.name);

    await writeFile(join(wsPath, "committed.txt"), "committed\n");
    await git(["add", "."], wsPath);
    await git(["config", "user.email", "test@hive.dev"], wsPath);
    await git(["config", "user.name", "Test"], wsPath);
    await git(["commit", "-m", "add committed file"], wsPath);

    await writeFile(join(wsPath, "README.md"), "local only change\n");

    const { committed, uncommitted } = await getWorkspaceDiffStat(ws.id, dataDir);

    expect(committed.some((s) => s.file === "committed.txt")).toBe(true);
    expect(
      uncommitted.some(
        (s) => s.file === "README.md" && s.status === "modified",
      ),
    ).toBe(true);
  });

  it("includes untracked files as 'added' in uncommitted stats", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    const wsPath = join(dataDir, projectId, "workspaces", ws.name);

    await writeFile(join(wsPath, "untracked.txt"), "hello\n");

    const { committed, uncommitted } = await getWorkspaceDiffStat(ws.id, dataDir);

    expect(committed).toEqual([]);
    const untracked = uncommitted.find((s) => s.file === "untracked.txt");
    expect(untracked).toBeDefined();
    expect(untracked!.status).toBe("added");
    expect(untracked!.additions).toBe(1);
    expect(untracked!.deletions).toBe(0);
  });

  it("does not duplicate files that are both tracked and untracked in diff stat", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    const wsPath = join(dataDir, projectId, "workspaces", ws.name);

    // Modify a tracked file (shows up in git diff) and create untracked
    await writeFile(join(wsPath, "README.md"), "modified\n");
    await writeFile(join(wsPath, "brand-new.txt"), "new\n");

    const { uncommitted } = await getWorkspaceDiffStat(ws.id, dataDir);

    const readmeEntries = uncommitted.filter((s) => s.file === "README.md");
    expect(readmeEntries).toHaveLength(1);

    const newFileEntries = uncommitted.filter((s) => s.file === "brand-new.txt");
    expect(newFileEntries).toHaveLength(1);
    expect(newFileEntries[0].status).toBe("added");
  });

  it("includes multiple untracked files in subdirectories", async () => {
    const ws = await createWorkspace(projectId, dataDir);
    const wsPath = join(dataDir, projectId, "workspaces", ws.name);

    await mkdir(join(wsPath, "subdir"), { recursive: true });
    await writeFile(join(wsPath, "top-level.txt"), "top\n");
    await writeFile(join(wsPath, "subdir", "nested.txt"), "nested\n");

    const { uncommitted } = await getWorkspaceDiffStat(ws.id, dataDir);

    const topLevel = uncommitted.find((s) => s.file === "top-level.txt");
    expect(topLevel).toBeDefined();
    expect(topLevel!.status).toBe("added");

    const nested = uncommitted.find((s) => s.file === "subdir/nested.txt");
    expect(nested).toBeDefined();
    expect(nested!.status).toBe("added");
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
