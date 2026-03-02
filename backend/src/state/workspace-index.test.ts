import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir, createFixtureRepo } from "../utils/test-helpers.js";
import { createProject } from "../projects/project-manager.js";
import { createWorkspace } from "../workspaces/workspace-manager.js";
import { deleteWorkspace, archiveWorkspace } from "../workspaces/workspace-manager.js";
import { saveProject, loadProject } from "./state.js";
import { deleteProject } from "../projects/project-manager.js";
import {
  initWorkspaceIndex,
  isInitialized,
  lookupWorkspace,
  notifyProjectSaved,
  notifyProjectDeleted,
  _clearForTests,
} from "./workspace-index.js";
import type { ProjectState } from "../types.js";

let tempDir: string;
let dataDir: string;
let fixtureRepoUrl: string;

beforeEach(async () => {
  _clearForTests();
  tempDir = await createTempDir("hive-ws-index-test-");
  dataDir = join(tempDir, "data");
  const fixtureDir = join(tempDir, "fixtures");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dataDir, { recursive: true });
  await mkdir(fixtureDir, { recursive: true });
  fixtureRepoUrl = await createFixtureRepo(fixtureDir);
});

afterEach(async () => {
  _clearForTests();
  await rm(tempDir, { recursive: true, force: true });
});

describe("workspace-index", () => {
  it("isInitialized returns false before init", () => {
    expect(isInitialized()).toBe(false);
  });

  it("lookupWorkspace returns null when index is empty", () => {
    expect(lookupWorkspace("ws-nonexistent")).toBeNull();
  });

  it("initWorkspaceIndex loads projects and populates the index", async () => {
    const project = await createProject(fixtureRepoUrl, dataDir);
    const ws = await createWorkspace(project.id, dataDir);

    // Index not yet initialized — lookupWorkspace won't find anything
    // even though the data is on disk, because init hasn't run.
    // (notifyProjectSaved fires from saveProject but is a no-op before init)
    _clearForTests();
    expect(lookupWorkspace(ws.id)).toBeNull();

    await initWorkspaceIndex(dataDir);

    expect(isInitialized()).toBe(true);
    const entry = lookupWorkspace(ws.id);
    expect(entry).not.toBeNull();
    expect(entry!.projectId).toBe(project.id);
    expect(entry!.workspace.id).toBe(ws.id);
    expect(entry!.projectState.id).toBe(project.id);
  });

  it("notifyProjectSaved adds new workspace entries", async () => {
    await initWorkspaceIndex(dataDir, async () => []);

    const state: ProjectState = {
      id: "proj-test1",
      name: "test",
      url: "https://example.com/test.git",
      createdAt: new Date().toISOString(),
      workspaces: [
        {
          id: "ws-aaa",
          name: "tokyo",
          projectId: "proj-test1",
          branch: "workspace/tokyo",
          status: "idle",
          createdAt: new Date().toISOString(),
        },
        {
          id: "ws-bbb",
          name: "paris",
          projectId: "proj-test1",
          branch: "workspace/paris",
          status: "idle",
          createdAt: new Date().toISOString(),
        },
      ],
    };

    notifyProjectSaved(state);

    expect(lookupWorkspace("ws-aaa")).not.toBeNull();
    expect(lookupWorkspace("ws-bbb")).not.toBeNull();
    expect(lookupWorkspace("ws-aaa")!.workspace.name).toBe("tokyo");
    expect(lookupWorkspace("ws-bbb")!.workspace.name).toBe("paris");
  });

  it("notifyProjectSaved replaces entries when workspace is removed", async () => {
    await initWorkspaceIndex(dataDir, async () => []);

    const state: ProjectState = {
      id: "proj-test1",
      name: "test",
      url: "https://example.com/test.git",
      createdAt: new Date().toISOString(),
      workspaces: [
        {
          id: "ws-aaa",
          name: "tokyo",
          projectId: "proj-test1",
          branch: "workspace/tokyo",
          status: "idle",
          createdAt: new Date().toISOString(),
        },
        {
          id: "ws-bbb",
          name: "paris",
          projectId: "proj-test1",
          branch: "workspace/paris",
          status: "idle",
          createdAt: new Date().toISOString(),
        },
      ],
    };
    notifyProjectSaved(state);

    // Remove ws-bbb
    const updated = { ...state, workspaces: [state.workspaces[0]] };
    notifyProjectSaved(updated);

    expect(lookupWorkspace("ws-aaa")).not.toBeNull();
    expect(lookupWorkspace("ws-bbb")).toBeNull();
  });

  it("notifyProjectSaved updates workspace fields", async () => {
    await initWorkspaceIndex(dataDir, async () => []);

    const state: ProjectState = {
      id: "proj-test1",
      name: "test",
      url: "https://example.com/test.git",
      createdAt: new Date().toISOString(),
      workspaces: [
        {
          id: "ws-aaa",
          name: "tokyo",
          projectId: "proj-test1",
          branch: "workspace/tokyo",
          status: "idle",
          createdAt: new Date().toISOString(),
        },
      ],
    };
    notifyProjectSaved(state);
    expect(lookupWorkspace("ws-aaa")!.workspace.status).toBe("idle");

    // Update status
    const updated: ProjectState = {
      ...state,
      workspaces: [{ ...state.workspaces[0], status: "busy" }],
    };
    notifyProjectSaved(updated);
    expect(lookupWorkspace("ws-aaa")!.workspace.status).toBe("busy");
  });

  it("notifyProjectDeleted removes all entries for a project", async () => {
    await initWorkspaceIndex(dataDir, async () => []);

    const state1: ProjectState = {
      id: "proj-1",
      name: "project-one",
      url: "https://example.com/one.git",
      createdAt: new Date().toISOString(),
      workspaces: [
        { id: "ws-1a", name: "a", projectId: "proj-1", branch: "workspace/a", status: "idle", createdAt: new Date().toISOString() },
      ],
    };
    const state2: ProjectState = {
      id: "proj-2",
      name: "project-two",
      url: "https://example.com/two.git",
      createdAt: new Date().toISOString(),
      workspaces: [
        { id: "ws-2a", name: "b", projectId: "proj-2", branch: "workspace/b", status: "idle", createdAt: new Date().toISOString() },
      ],
    };
    notifyProjectSaved(state1);
    notifyProjectSaved(state2);

    expect(lookupWorkspace("ws-1a")).not.toBeNull();
    expect(lookupWorkspace("ws-2a")).not.toBeNull();

    notifyProjectDeleted("proj-1");

    expect(lookupWorkspace("ws-1a")).toBeNull();
    expect(lookupWorkspace("ws-2a")).not.toBeNull();
  });

  it("notifyProjectSaved is no-op before initialization", () => {
    // Should not throw
    notifyProjectSaved({
      id: "proj-1",
      name: "test",
      url: "https://example.com/test.git",
      createdAt: new Date().toISOString(),
      workspaces: [
        { id: "ws-1", name: "a", projectId: "proj-1", branch: "b", status: "idle", createdAt: new Date().toISOString() },
      ],
    });
    // Still not initialized, so lookup returns null
    expect(lookupWorkspace("ws-1")).toBeNull();
  });

  it("notifyProjectDeleted is no-op before initialization", () => {
    // Should not throw
    notifyProjectDeleted("proj-nonexistent");
  });

  it("_clearForTests resets the index", async () => {
    await initWorkspaceIndex(dataDir, async () => [
      {
        id: "proj-1",
        name: "test",
        url: "https://example.com/test.git",
        createdAt: new Date().toISOString(),
        workspaces: [
          { id: "ws-1", name: "a", projectId: "proj-1", branch: "b", status: "idle", createdAt: new Date().toISOString() },
        ],
      },
    ]);

    expect(isInitialized()).toBe(true);
    expect(lookupWorkspace("ws-1")).not.toBeNull();

    _clearForTests();

    expect(isInitialized()).toBe(false);
    expect(lookupWorkspace("ws-1")).toBeNull();
  });

  it("integrates with real createWorkspace and deleteWorkspace flows", async () => {
    const project = await createProject(fixtureRepoUrl, dataDir);
    await initWorkspaceIndex(dataDir);

    // Create a workspace — saveProject fires notifyProjectSaved
    const ws = await createWorkspace(project.id, dataDir);

    const entry = lookupWorkspace(ws.id);
    expect(entry).not.toBeNull();
    expect(entry!.projectId).toBe(project.id);
    expect(entry!.workspace.name).toBe(ws.name);
  });

  it("integrates with deleteProject", async () => {
    const project = await createProject(fixtureRepoUrl, dataDir);
    const ws = await createWorkspace(project.id, dataDir);
    await initWorkspaceIndex(dataDir);

    expect(lookupWorkspace(ws.id)).not.toBeNull();

    await deleteProject(project.id, dataDir);

    expect(lookupWorkspace(ws.id)).toBeNull();
  });

  it("integrates with deleteWorkspace and removes the index entry", async () => {
    const project = await createProject(fixtureRepoUrl, dataDir);
    await initWorkspaceIndex(dataDir);
    const ws = await createWorkspace(project.id, dataDir);

    expect(lookupWorkspace(ws.id)).not.toBeNull();

    await deleteWorkspace(ws.id, dataDir);

    expect(lookupWorkspace(ws.id)).toBeNull();
  });

  it("integrates with archiveWorkspace and removes the index entry", async () => {
    const project = await createProject(fixtureRepoUrl, dataDir);
    await initWorkspaceIndex(dataDir);
    const ws = await createWorkspace(project.id, dataDir);

    expect(lookupWorkspace(ws.id)).not.toBeNull();

    await archiveWorkspace(ws.id, dataDir);

    expect(lookupWorkspace(ws.id)).toBeNull();
  });

  it("tracks branch updates persisted through saveProject", async () => {
    const project = await createProject(fixtureRepoUrl, dataDir);
    await initWorkspaceIndex(dataDir);
    const ws = await createWorkspace(project.id, dataDir);

    expect(lookupWorkspace(ws.id)!.workspace.branch).toBe(`workspace/${ws.name}`);

    const state = await loadProject(project.id, dataDir);
    expect(state).not.toBeNull();
    const target = state!.workspaces.find((w) => w.id === ws.id);
    expect(target).toBeDefined();
    target!.branch = "workspace/renamed-from-test";
    await saveProject(state!, dataDir);

    const updated = lookupWorkspace(ws.id);
    expect(updated).not.toBeNull();
    expect(updated!.workspace.branch).toBe("workspace/renamed-from-test");
    expect(updated!.projectState.workspaces.find((w) => w.id === ws.id)?.branch).toBe(
      "workspace/renamed-from-test",
    );
  });
});
