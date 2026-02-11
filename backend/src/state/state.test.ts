import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadProject, saveProject, loadAllProjects, deleteProjectState } from "./state.js";
import type { ProjectState } from "../types.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "hive-state-test-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

function makeState(id: string): ProjectState {
  return {
    id,
    name: "test-project",
    url: "git@github.com:test/repo.git",
    createdAt: new Date().toISOString(),
    workspaces: [],
  };
}

describe("saveProject + loadProject", () => {
  it("round-trips a project state", async () => {
    const state = makeState("proj-1");
    await saveProject(state, dataDir);
    const loaded = await loadProject("proj-1", dataDir);
    expect(loaded).toEqual(state);
  });

  it("produces valid pretty-printed JSON on disk", async () => {
    const state = makeState("proj-2");
    await saveProject(state, dataDir);
    const raw = await readFile(join(dataDir, "proj-2", "state.json"), "utf-8");
    expect(raw).toContain("\n"); // pretty-printed
    expect(JSON.parse(raw)).toEqual(state);
  });
});

describe("loadProject", () => {
  it("returns null for non-existent project", async () => {
    const result = await loadProject("nonexistent", dataDir);
    expect(result).toBeNull();
  });

  it("returns null for corrupt JSON", async () => {
    const dir = join(dataDir, "corrupt");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "state.json"), "not valid json{{{", "utf-8");
    const result = await loadProject("corrupt", dataDir);
    expect(result).toBeNull();
  });
});

describe("loadAllProjects", () => {
  it("loads all project states from directory", async () => {
    for (const id of ["proj-a", "proj-b", "proj-c"]) {
      await saveProject(makeState(id), dataDir);
    }
    const results = await loadAllProjects(dataDir);
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.id).sort()).toEqual(["proj-a", "proj-b", "proj-c"]);
  });

  it("skips directories without state.json", async () => {
    await saveProject(makeState("valid"), dataDir);
    await mkdir(join(dataDir, "empty-dir"), { recursive: true });
    const results = await loadAllProjects(dataDir);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("valid");
  });

  it("returns empty array for non-existent data dir", async () => {
    const results = await loadAllProjects("/tmp/nonexistent-hive-dir");
    expect(results).toEqual([]);
  });
});

describe("deleteProjectState", () => {
  it("removes the state.json file", async () => {
    await saveProject(makeState("to-delete"), dataDir);
    await deleteProjectState("to-delete", dataDir);
    const result = await loadProject("to-delete", dataDir);
    expect(result).toBeNull();
  });

  it("does not throw for non-existent project", async () => {
    await expect(deleteProjectState("nonexistent", dataDir)).resolves.not.toThrow();
  });
});
