import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { join } from "node:path";
import type { Workspace } from "../types.js";

const mocks = vi.hoisted(() => ({
  createWorkspace: vi.fn(),
  listWorkspaces: vi.fn(),
  getWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  getWorkspaceDiff: vi.fn(),
  getWorkspaceDiffStat: vi.fn(),
  listWorkspaceFiles: vi.fn(),
  getWorkspaceFileContent: vi.fn(),
  mergeWorkspace: vi.fn(),
  archiveWorkspace: vi.fn(),
  endSession: vi.fn(),
  parseGitHubRepo: vi.fn(),
  fetchPrForBranch: vi.fn(),
  getBranchName: vi.fn(),
  readHiveConfig: vi.fn(),
  startScript: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

vi.mock("../workspaces/workspace-manager.js", () => ({
  createWorkspace: mocks.createWorkspace,
  listWorkspaces: mocks.listWorkspaces,
  getWorkspace: mocks.getWorkspace,
  deleteWorkspace: mocks.deleteWorkspace,
  getWorkspaceDiff: mocks.getWorkspaceDiff,
  getWorkspaceDiffStat: mocks.getWorkspaceDiffStat,
  listWorkspaceFiles: mocks.listWorkspaceFiles,
  getWorkspaceFileContent: mocks.getWorkspaceFileContent,
  mergeWorkspace: mocks.mergeWorkspace,
  archiveWorkspace: mocks.archiveWorkspace,
}));

vi.mock("../agents/agent-manager.js", () => ({
  endSession: mocks.endSession,
}));

vi.mock("../utils/github.js", () => ({
  parseGitHubRepo: mocks.parseGitHubRepo,
  fetchPrForBranch: mocks.fetchPrForBranch,
}));

vi.mock("../services/git-sync.js", () => ({
  getBranchName: mocks.getBranchName,
}));

vi.mock("../utils/hive-config.js", () => ({
  readHiveConfig: mocks.readHiveConfig,
}));

vi.mock("../services/script-runner.js", () => ({
  startScript: mocks.startScript,
}));

vi.mock("../ws/stream.js", () => ({
  broadcastToWorkspace: mocks.broadcastToWorkspace,
}));

import { workspaceRoutes } from "./workspaces.js";

const DATA_DIR = "/tmp/hive-auto-setup-test";
const PROJECT_ID = "project-1";

const workspace: Workspace = {
  id: "ws-1",
  name: "tokyo",
  projectId: PROJECT_ID,
  branch: "workspace/tokyo",
  status: "idle",
  createdAt: "2026-02-23T00:00:00.000Z",
};

let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  vi.clearAllMocks();

  mocks.createWorkspace.mockResolvedValue(workspace);
  mocks.readHiveConfig.mockResolvedValue(null);
  mocks.startScript.mockReturnValue({ exitListeners: new Map<string, (code: number) => void>() });

  app = Fastify();
  await app.register((instance: FastifyInstance) => workspaceRoutes(instance, DATA_DIR));
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("POST /api/projects/:id/workspaces auto-setup", () => {
  it("starts setup script when hive.json defines scripts.setup", async () => {
    const exitListeners = new Map<string, (code: number) => void>();
    mocks.readHiveConfig.mockResolvedValueOnce({ scripts: { setup: "npm ci" } });
    mocks.startScript.mockReturnValueOnce({ exitListeners });

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${PROJECT_ID}/workspaces`,
    });

    expect(res.statusCode).toBe(201);
    expect(mocks.createWorkspace).toHaveBeenCalledWith(PROJECT_ID, DATA_DIR, undefined);

    const wsPath = join(DATA_DIR, PROJECT_ID, "workspaces", workspace.name);
    expect(mocks.readHiveConfig).toHaveBeenCalledWith(wsPath);
    expect(mocks.startScript).toHaveBeenCalledWith(workspace.id, "setup", "npm ci", wsPath);
    expect(mocks.broadcastToWorkspace).toHaveBeenCalledWith(workspace.id, {
      type: "script_status",
      scriptType: "setup",
      state: "running",
    });

    expect(exitListeners.size).toBe(1);
    const listener = [...exitListeners.values()][0];
    mocks.broadcastToWorkspace.mockClear();
    listener(0);

    expect(mocks.broadcastToWorkspace).toHaveBeenCalledWith(workspace.id, {
      type: "script_status",
      scriptType: "setup",
      state: "done",
      exitCode: 0,
    });
    expect(exitListeners.size).toBe(0);
  });

  it("does nothing when scripts.setup is missing", async () => {
    mocks.readHiveConfig.mockResolvedValueOnce({
      scripts: { run: { dev: "npm run dev" } },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${PROJECT_ID}/workspaces`,
    });

    expect(res.statusCode).toBe(201);
    expect(mocks.startScript).not.toHaveBeenCalled();
    expect(mocks.broadcastToWorkspace).not.toHaveBeenCalled();
  });

  it("still returns 201 when auto-setup fails", async () => {
    mocks.readHiveConfig.mockResolvedValueOnce({ scripts: { setup: "npm ci" } });
    mocks.startScript.mockImplementationOnce(() => {
      throw new Error("setup launch failed");
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${PROJECT_ID}/workspaces`,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual(workspace);
  });

  it("still returns 201 when hive config cannot be read", async () => {
    mocks.readHiveConfig.mockRejectedValueOnce(new Error("cannot read hive.json"));

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${PROJECT_ID}/workspaces`,
    });

    expect(res.statusCode).toBe(201);
    expect(mocks.startScript).not.toHaveBeenCalled();
  });
});
