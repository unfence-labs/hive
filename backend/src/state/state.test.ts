import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadProject,
  saveProject,
  loadAllProjects,
  deleteProjectState,
  withProjectStateLock,
  _clearProjectLocksForTests,
} from "./state.js";
import type { ProjectState } from "../types.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "hive-state-test-"));
});

afterEach(async () => {
  _clearProjectLocksForTests();
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

  it("returns null for a non-project state.json (e.g. the Brain) lacking workspaces", async () => {
    const dir = join(dataDir, "brain");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "state.json"),
      JSON.stringify({ exists: true, repoUrl: "git@github.com:test/brain.git" }),
      "utf-8",
    );
    const result = await loadProject("brain", dataDir);
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

  it("ignores loose files in the data directory", async () => {
    await saveProject(makeState("proj-ok"), dataDir);
    await writeFile(join(dataDir, "config.json"), '{"key":"val"}', "utf-8");
    await writeFile(join(dataDir, ".DS_Store"), "", "utf-8");
    const results = await loadAllProjects(dataDir);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("proj-ok");
  });

  it("ignores nested non-project directories like prompts/", async () => {
    await saveProject(makeState("proj-real"), dataDir);
    await mkdir(join(dataDir, "prompts"), { recursive: true });
    await mkdir(join(dataDir, "archive"), { recursive: true });
    const results = await loadAllProjects(dataDir);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("proj-real");
  });

  it("ignores a Brain directory whose state.json is not a project", async () => {
    // Regression: the Brain stores $DATA_DIR/brain/state.json, which previously
    // got loaded as a malformed project and broke workspace reconciliation.
    await saveProject(makeState("proj-real"), dataDir);
    const brainDir = join(dataDir, "brain");
    await mkdir(brainDir, { recursive: true });
    await writeFile(
      join(brainDir, "state.json"),
      JSON.stringify({ exists: true, repoUrl: "git@github.com:test/brain.git" }),
      "utf-8",
    );
    const results = await loadAllProjects(dataDir);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("proj-real");
    // Every returned project must have an iterable workspaces array.
    expect(results.every((p) => Array.isArray(p.workspaces))).toBe(true);
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

describe("withProjectStateLock", () => {
  it("serializes concurrent operations for the same project", async () => {
    const order: string[] = [];
    const projectId = "proj-lock";

    const first = withProjectStateLock(projectId, async () => {
      order.push("first:start");
      await new Promise((r) => setTimeout(r, 30));
      order.push("first:end");
    }, dataDir);

    const second = withProjectStateLock(projectId, async () => {
      order.push("second:start");
      order.push("second:end");
    }, dataDir);

    await Promise.all([first, second]);

    expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  it("allows parallel operations for different projects", async () => {
    const started: string[] = [];
    const done: string[] = [];

    const first = withProjectStateLock("proj-a", async () => {
      started.push("a");
      await new Promise((r) => setTimeout(r, 20));
      done.push("a");
    }, dataDir);

    const second = withProjectStateLock("proj-b", async () => {
      started.push("b");
      await new Promise((r) => setTimeout(r, 20));
      done.push("b");
    }, dataDir);

    await Promise.all([first, second]);

    expect(started.sort()).toEqual(["a", "b"]);
    expect(done.sort()).toEqual(["a", "b"]);
  });
});
