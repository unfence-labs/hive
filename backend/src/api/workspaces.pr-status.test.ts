import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { ProjectState, PullRequestInfo, Workspace } from "../types.js";

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

import { join } from "node:path";
import { workspaceRoutes } from "./workspaces.js";

function makePr(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    number: 42,
    url: "https://github.com/acme/widget/pull/42",
    state: "open",
    mergeable: true,
    mergeableState: "clean",
    checksStatus: "success",
    checksPassed: null,
    checksTotal: null,
    reviewStatus: null,
    ...overrides,
  };
}

const DATA_DIR = "/tmp/hive-pr-status-test";
const PROJECT_ID = "project-1";
const WORKSPACE_ID = "ws-1";
const WORKSPACE_NAME = "tokyo";

const workspace: Workspace = {
  id: WORKSPACE_ID,
  name: WORKSPACE_NAME,
  projectId: PROJECT_ID,
  branch: "workspace/tokyo",
  status: "idle",
  createdAt: "2026-02-21T00:00:00.000Z",
};

const projectState: ProjectState = {
  id: PROJECT_ID,
  name: "acme-widget",
  url: "https://github.com/acme/widget",
  createdAt: "2026-02-21T00:00:00.000Z",
  workspaces: [workspace],
};

let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  vi.clearAllMocks();

  mocks.getWorkspace.mockResolvedValue({
    workspace,
    projectState,
  });
  mocks.parseGitHubRepo.mockReturnValue({ owner: "acme", repo: "widget" });
  mocks.getBranchName.mockResolvedValue("feature/from-git");
  mocks.fetchPrForBranch.mockResolvedValue({ pr: makePr() });

  app = Fastify();
  await app.register((instance: FastifyInstance) => workspaceRoutes(instance, DATA_DIR));
  await app.ready();
});

afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
});

describe("GET /api/workspaces/:wsId/pr-status", () => {
  it("returns PR status for a GitHub workspace", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${WORKSPACE_ID}/pr-status`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ pr: makePr() });

    expect(mocks.getBranchName).toHaveBeenCalledWith(
      join(DATA_DIR, PROJECT_ID, "workspaces", WORKSPACE_NAME),
    );
    expect(mocks.fetchPrForBranch).toHaveBeenCalledWith(
      "acme",
      "widget",
      "feature/from-git",
    );
  });

  it("falls back to workspace.branch when getBranchName fails", async () => {
    mocks.getBranchName.mockRejectedValueOnce(new Error("worktree missing"));

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${WORKSPACE_ID}/pr-status`,
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.fetchPrForBranch).toHaveBeenCalledWith(
      "acme",
      "widget",
      "workspace/tokyo",
    );
  });

  it("returns PR errors from gh without failing the endpoint", async () => {
    mocks.fetchPrForBranch.mockResolvedValueOnce({
      pr: null,
      error: "gh not authenticated — run `gh auth login`",
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${WORKSPACE_ID}/pr-status`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      pr: null,
      error: "gh not authenticated — run `gh auth login`",
    });
  });

  it("returns 404 when workspace does not exist", async () => {
    mocks.getWorkspace.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: "GET",
      url: "/api/workspaces/missing/pr-status",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Workspace not found" });
    expect(mocks.fetchPrForBranch).not.toHaveBeenCalled();
  });

  it("returns pr:null for non-GitHub repositories", async () => {
    mocks.parseGitHubRepo.mockReturnValueOnce(null);

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${WORKSPACE_ID}/pr-status`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ pr: null });
    expect(mocks.getBranchName).not.toHaveBeenCalled();
    expect(mocks.fetchPrForBranch).not.toHaveBeenCalled();
  });

  it("uses cache for repeated calls within TTL", async () => {
    mocks.fetchPrForBranch.mockResolvedValueOnce({ pr: makePr({ number: 1 }) });

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
    const first = await app.inject({
      method: "GET",
      url: `/api/workspaces/${WORKSPACE_ID}/pr-status`,
    });
    const second = await app.inject({
      method: "GET",
      url: `/api/workspaces/${WORKSPACE_ID}/pr-status`,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json()).toEqual({ pr: makePr({ number: 1 }) });
    expect(second.json()).toEqual({ pr: makePr({ number: 1 }) });
    expect(mocks.getWorkspace).toHaveBeenCalledTimes(1);
    expect(mocks.fetchPrForBranch).toHaveBeenCalledTimes(1);

    nowSpy.mockRestore();
  });

  it("refreshes cache after TTL expires", async () => {
    mocks.fetchPrForBranch
      .mockResolvedValueOnce({ pr: makePr({ number: 1 }) })
      .mockResolvedValueOnce({ pr: makePr({ number: 2 }) });

    let now = 100_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);

    const first = await app.inject({
      method: "GET",
      url: `/api/workspaces/${WORKSPACE_ID}/pr-status`,
    });
    now += 15_001;
    const second = await app.inject({
      method: "GET",
      url: `/api/workspaces/${WORKSPACE_ID}/pr-status`,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json()).toEqual({ pr: makePr({ number: 1 }) });
    expect(second.json()).toEqual({ pr: makePr({ number: 2 }) });
    expect(mocks.fetchPrForBranch).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
  });

  it("invalidates cached PR status after workspace deletion", async () => {
    mocks.fetchPrForBranch
      .mockResolvedValueOnce({ pr: makePr({ number: 1 }) })
      .mockResolvedValueOnce({ pr: makePr({ number: 2 }) });
    mocks.deleteWorkspace.mockResolvedValueOnce(undefined);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);

    await app.inject({
      method: "GET",
      url: `/api/workspaces/${WORKSPACE_ID}/pr-status`,
    });
    expect(mocks.fetchPrForBranch).toHaveBeenCalledTimes(1);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/workspaces/${WORKSPACE_ID}`,
    });
    expect(del.statusCode).toBe(204);

    const afterDelete = await app.inject({
      method: "GET",
      url: `/api/workspaces/${WORKSPACE_ID}/pr-status`,
    });

    expect(afterDelete.statusCode).toBe(200);
    expect(afterDelete.json()).toEqual({ pr: makePr({ number: 2 }) });
    expect(mocks.fetchPrForBranch).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
  });

  it("invalidates cached PR status after workspace archival", async () => {
    mocks.fetchPrForBranch
      .mockResolvedValueOnce({ pr: makePr({ number: 10 }) })
      .mockResolvedValueOnce({ pr: makePr({ number: 11 }) });
    mocks.endSession.mockResolvedValueOnce(undefined);
    mocks.archiveWorkspace.mockResolvedValueOnce(undefined);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(200_000);

    await app.inject({
      method: "GET",
      url: `/api/workspaces/${WORKSPACE_ID}/pr-status`,
    });
    expect(mocks.fetchPrForBranch).toHaveBeenCalledTimes(1);

    const archived = await app.inject({
      method: "POST",
      url: `/api/workspaces/${WORKSPACE_ID}/archive`,
    });
    expect(archived.statusCode).toBe(204);

    const afterArchive = await app.inject({
      method: "GET",
      url: `/api/workspaces/${WORKSPACE_ID}/pr-status`,
    });

    expect(afterArchive.statusCode).toBe(200);
    expect(afterArchive.json()).toEqual({ pr: makePr({ number: 11 }) });
    expect(mocks.fetchPrForBranch).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
  });

  it("returns 500 when an unexpected error bubbles up", async () => {
    mocks.fetchPrForBranch.mockRejectedValueOnce(new Error("boom"));

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${WORKSPACE_ID}/pr-status`,
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "boom" });
  });
});

describe("POST /api/workspaces/pr-status/bulk", () => {
  it("limits concurrent GitHub PR status fetches", async () => {
    const workspaces = Array.from({ length: 6 }, (_, index): Workspace => ({
      ...workspace,
      id: `ws-${index + 1}`,
      name: `city-${index + 1}`,
      branch: `workspace/city-${index + 1}`,
    }));
    mocks.getWorkspace.mockImplementation(async (wsId: string) => {
      const found = workspaces.find((entry) => entry.id === wsId);
      return found ? { workspace: found, projectState: { ...projectState, workspaces } } : null;
    });

    let active = 0;
    let maxActive = 0;
    mocks.fetchPrForBranch.mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return { pr: makePr() };
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/workspaces/pr-status/bulk",
      payload: { workspaceIds: workspaces.map((entry) => entry.id) },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.fetchPrForBranch).toHaveBeenCalledTimes(6);
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it("returns PR status for multiple workspaces", async () => {
    const ws2: Workspace = { ...workspace, id: "ws-2", name: "paris", branch: "workspace/paris" };
    const ps2: ProjectState = { ...projectState, workspaces: [ws2] };

    mocks.getWorkspace
      .mockResolvedValueOnce({ workspace, projectState })
      .mockResolvedValueOnce({ workspace: ws2, projectState: ps2 });
    mocks.fetchPrForBranch
      .mockResolvedValueOnce({ pr: makePr({ number: 1 }) })
      .mockResolvedValueOnce({ pr: makePr({ number: 2 }) });

    const res = await app.inject({
      method: "POST",
      url: "/api/workspaces/pr-status/bulk",
      payload: { workspaceIds: [WORKSPACE_ID, "ws-2"] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results[WORKSPACE_ID].pr.number).toBe(1);
    expect(body.results["ws-2"].pr.number).toBe(2);
  });

  it("handles partial failures (one workspace not found)", async () => {
    mocks.getWorkspace
      .mockResolvedValueOnce({ workspace, projectState })
      .mockResolvedValueOnce(null);
    mocks.fetchPrForBranch.mockResolvedValueOnce({ pr: makePr({ number: 1 }) });

    const res = await app.inject({
      method: "POST",
      url: "/api/workspaces/pr-status/bulk",
      payload: { workspaceIds: [WORKSPACE_ID, "ws-missing"] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results[WORKSPACE_ID].pr.number).toBe(1);
    expect(body.results["ws-missing"]).toEqual({ pr: null, error: "Workspace not found" });
  });

  it("shares cache with the single endpoint", async () => {
    mocks.fetchPrForBranch.mockResolvedValueOnce({ pr: makePr({ number: 7 }) });
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);

    // Bulk populates cache
    await app.inject({
      method: "POST",
      url: "/api/workspaces/pr-status/bulk",
      payload: { workspaceIds: [WORKSPACE_ID] },
    });

    // Single reads from cache
    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${WORKSPACE_ID}/pr-status`,
    });

    expect(res.json()).toEqual({ pr: makePr({ number: 7 }) });
    expect(mocks.fetchPrForBranch).toHaveBeenCalledTimes(1);

    nowSpy.mockRestore();
  });

  it("returns 400 when body is invalid", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/workspaces/pr-status/bulk",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "workspaceIds must be an array" });
  });

  it("returns empty results for empty array", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/workspaces/pr-status/bulk",
      payload: { workspaceIds: [] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ results: {} });
  });
});
