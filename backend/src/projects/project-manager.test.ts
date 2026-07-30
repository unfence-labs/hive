import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createTempDir, createFixtureRepo } from "../utils/test-helpers.js";
import { createProject, initProject, listProjects, getProject, deleteProject, fetchProject } from "./project-manager.js";

let tempDir: string;
let dataDir: string;
let fixtureRepoUrl: string;

beforeEach(async () => {
  tempDir = await createTempDir("hive-proj-test-");
  dataDir = join(tempDir, "data");
  const fixtureDir = join(tempDir, "fixtures");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dataDir, { recursive: true });
  await mkdir(fixtureDir, { recursive: true });
  fixtureRepoUrl = await createFixtureRepo(fixtureDir);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("createProject", () => {
  it("clones a bare repo and creates state", async () => {
    const state = await createProject(fixtureRepoUrl, dataDir);
    expect(state.id).toMatch(/^proj-/);
    expect(state.name).toBe("fixture");
    expect(state.url).toBe(fixtureRepoUrl);
    expect(state.workspaces).toEqual([]);
    expect(existsSync(join(dataDir, state.id, "repo.git", "HEAD"))).toBe(true);
    expect(existsSync(join(dataDir, state.id, "workspaces"))).toBe(true);
    expect(existsSync(join(dataDir, state.id, "logs"))).toBe(true);
    expect(existsSync(join(dataDir, state.id, "state.json"))).toBe(true);
  });

  it("rejects empty URL", async () => {
    await expect(createProject("", dataDir)).rejects.toThrow("Invalid repository URL");
  });

  it("rejects local repository paths outside test mode", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      await expect(createProject(fixtureRepoUrl, dataDir)).rejects.toThrow("Local repository paths are not allowed");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("listProjects", () => {
  it("returns all created projects", async () => {
    await createProject(fixtureRepoUrl, dataDir);
    await createProject(fixtureRepoUrl, dataDir);
    const projects = await listProjects(dataDir);
    expect(projects).toHaveLength(2);
    expect(projects[0].name).toBe("fixture");
  });

  it("returns empty array when no projects", async () => {
    const projects = await listProjects(dataDir);
    expect(projects).toEqual([]);
  });
});

describe("getProject", () => {
  it("returns full project state", async () => {
    const created = await createProject(fixtureRepoUrl, dataDir);
    const loaded = await getProject(created.id, dataDir);
    expect(loaded).toEqual(created);
  });

  it("returns null for non-existent project", async () => {
    const result = await getProject("nonexistent", dataDir);
    expect(result).toBeNull();
  });
});

describe("deleteProject", () => {
  it("removes entire project directory", async () => {
    const state = await createProject(fixtureRepoUrl, dataDir);
    const projDir = join(dataDir, state.id);
    expect(existsSync(projDir)).toBe(true);
    await deleteProject(state.id, dataDir);
    expect(existsSync(projDir)).toBe(false);
  });

  it("prunes the deleted project from sidebar folder refs", async () => {
    const state = await createProject(fixtureRepoUrl, dataDir);
    const { writeFile, readFile } = await import("node:fs/promises");
    await writeFile(
      join(dataDir, "ui-preferences.json"),
      JSON.stringify({
        sidebar: {
          folders: [
            { id: "f1", name: "Work", projectIds: [state.id, "other"] },
          ],
          folderOpenState: { f1: true },
        },
      }),
      "utf-8",
    );

    await deleteProject(state.id, dataDir);

    const onDisk = JSON.parse(
      await readFile(join(dataDir, "ui-preferences.json"), "utf-8"),
    );
    expect(onDisk.sidebar.folders[0].projectIds).toEqual(["other"]);
  });
});

describe("initProject", () => {
  it("creates a bare repo with initial commit and state", async () => {
    const { state } = await initProject("my-test-repo", {}, dataDir);
    expect(state.id).toMatch(/^proj-/);
    expect(state.name).toBe("my-test-repo");
    expect(state.url).toBeUndefined();
    expect(state.workspaces).toEqual([]);
    expect(existsSync(join(dataDir, state.id, "repo.git", "HEAD"))).toBe(true);
    expect(existsSync(join(dataDir, state.id, "workspaces"))).toBe(true);
    expect(existsSync(join(dataDir, state.id, "logs"))).toBe(true);
    expect(existsSync(join(dataDir, state.id, "state.json"))).toBe(true);
  });

  it("creates local-only project when no visibility is set", async () => {
    const { state, warning } = await initProject("local-only", {}, dataDir);
    expect(state.url).toBeUndefined();
    expect(warning).toBeUndefined();
    const loaded = await getProject(state.id, dataDir);
    expect(loaded?.url).toBeUndefined();
  });

  it("creates a GitHub repo and stores its HTTPS URL", async () => {
    const githubModule = await import("../utils/github.js");
    const gitModule = await import("../utils/git.js");
    const originalGit = gitModule.git;

    const createGitHubRepositorySpy = vi
      .spyOn(githubModule, "createGitHubRepository")
      .mockResolvedValue({
        owner: "octocat",
        name: "remote-repo",
        fullName: "octocat/remote-repo",
        url: "https://github.com/octocat/remote-repo",
      });

    const gitSpy = vi.spyOn(gitModule, "git").mockImplementation(async (args, cwd) => {
      if (args.join(" ") === "push --all origin") {
        return { stdout: "", stderr: "" };
      }
      return originalGit(args, cwd);
    });

    try {
      const { state, warning } = await initProject(
        "remote-repo",
        { visibility: "private" },
        dataDir,
      );

      expect(warning).toBeUndefined();
      expect(state.url).toBe("https://github.com/octocat/remote-repo");
      expect(createGitHubRepositorySpy).toHaveBeenCalledWith("remote-repo", "private");
      expect(gitSpy).toHaveBeenCalledWith([
        "remote",
        "add",
        "origin",
        "https://github.com/octocat/remote-repo",
      ], expect.any(String));

      const loaded = await getProject(state.id, dataDir);
      expect(loaded?.url).toBe("https://github.com/octocat/remote-repo");
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("rejects empty name", async () => {
    await expect(initProject("", {}, dataDir)).rejects.toThrow("Repository name is required");
  });

  it("rejects name with invalid characters", async () => {
    await expect(initProject("my repo!", {}, dataDir)).rejects.toThrow(
      "Repository name can only contain lowercase letters, numbers, hyphens, underscores, and dots",
    );
  });

  it("rejects name exceeding 100 characters", async () => {
    const longName = "a".repeat(101);
    await expect(initProject(longName, {}, dataDir)).rejects.toThrow(
      "Repository name must be 100 characters or fewer",
    );
  });

  it("rejects name starting with a hyphen", async () => {
    await expect(initProject("-bad-name", {}, dataDir)).rejects.toThrow(
      "Repository name can only contain lowercase letters, numbers, hyphens, underscores, and dots",
    );
  });

  it("cleans up directory on git failure", async () => {
    const { readdir } = await import("node:fs/promises");
    const before = await readdir(dataDir);

    // Stub git to fail after mkdir
    const gitModule = await import("../utils/git.js");
    const originalGit = gitModule.git;
    let callCount = 0;
    vi.spyOn(gitModule, "git").mockImplementation(async (args, cwd) => {
      callCount++;
      if (callCount === 1) {
        // Let git init --bare succeed
        return originalGit(args, cwd);
      }
      // Fail on git clone (second call)
      throw new Error("Simulated git failure");
    });

    try {
      await expect(initProject("will-fail", {}, dataDir)).rejects.toThrow("Simulated git failure");
      const after = await readdir(dataDir);
      // The orphaned project directory should have been cleaned up
      expect(after).toEqual(before);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("fetchProject", () => {
  it("fetches without error", async () => {
    const state = await createProject(fixtureRepoUrl, dataDir);
    await expect(fetchProject(state.id, dataDir)).resolves.not.toThrow();
  });

  it("throws for non-existent project", async () => {
    await expect(fetchProject("nonexistent", dataDir)).rejects.toThrow("not found");
  });
});
