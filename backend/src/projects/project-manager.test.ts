import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createTempDir, createFixtureRepo } from "../utils/test-helpers.js";
import { createProject, listProjects, getProject, deleteProject, fetchProject } from "./project-manager.js";

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
