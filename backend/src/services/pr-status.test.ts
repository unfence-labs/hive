import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ProjectState, PullRequestInfo, Workspace } from "../types.js";

const mocks = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  parseGitHubRepo: vi.fn(),
  fetchPrForBranch: vi.fn(),
  getBranchName: vi.fn(),
}));

vi.mock("../workspaces/workspace-manager.js", () => ({
  getWorkspace: mocks.getWorkspace,
}));

vi.mock("../utils/github.js", () => ({
  parseGitHubRepo: mocks.parseGitHubRepo,
  fetchPrForBranch: mocks.fetchPrForBranch,
}));

vi.mock("../utils/worktree.js", () => ({
  getBranchName: mocks.getBranchName,
}));

import { join } from "node:path";
import { PrStatusService } from "./pr-status.js";

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

let service: PrStatusService;

beforeEach(() => {
  vi.clearAllMocks();

  mocks.getWorkspace.mockResolvedValue({ workspace, projectState });
  mocks.parseGitHubRepo.mockReturnValue({ owner: "acme", repo: "widget" });
  mocks.getBranchName.mockResolvedValue("feature/from-git");
  mocks.fetchPrForBranch.mockResolvedValue({ pr: makePr() });
  service = new PrStatusService(DATA_DIR);
});

afterEach(() => {
  service._clearForTests();
  vi.restoreAllMocks();
});

describe("PrStatusService", () => {
  it("returns PR status for a GitHub workspace", async () => {
    await expect(service.getStatus(WORKSPACE_ID)).resolves.toEqual({ pr: makePr() });

    expect(mocks.getBranchName).toHaveBeenCalledWith(
      join(DATA_DIR, PROJECT_ID, "workspaces", WORKSPACE_NAME),
    );
    expect(mocks.fetchPrForBranch).toHaveBeenCalledWith("acme", "widget", "feature/from-git");
  });

  it("falls back to workspace.branch when getBranchName fails", async () => {
    mocks.getBranchName.mockRejectedValueOnce(new Error("worktree missing"));

    await service.getStatus(WORKSPACE_ID);

    expect(mocks.fetchPrForBranch).toHaveBeenCalledWith("acme", "widget", "workspace/tokyo");
  });

  it("returns PR errors from gh without throwing", async () => {
    mocks.fetchPrForBranch.mockResolvedValueOnce({
      pr: null,
      error: "gh not authenticated - run `gh auth login`",
    });

    await expect(service.getStatus(WORKSPACE_ID)).resolves.toEqual({
      pr: null,
      error: "gh not authenticated - run `gh auth login`",
    });
  });

  it("returns an error status when workspace does not exist", async () => {
    mocks.getWorkspace.mockResolvedValueOnce(null);

    await expect(service.getStatus("missing")).resolves.toEqual({
      pr: null,
      error: "Workspace not found",
    });
    expect(mocks.fetchPrForBranch).not.toHaveBeenCalled();
  });

  it("returns pr:null for non-GitHub repositories", async () => {
    mocks.parseGitHubRepo.mockReturnValueOnce(null);

    await expect(service.getStatus(WORKSPACE_ID)).resolves.toEqual({ pr: null });
    expect(mocks.getBranchName).not.toHaveBeenCalled();
    expect(mocks.fetchPrForBranch).not.toHaveBeenCalled();
  });

  it("uses cache for repeated calls within TTL", async () => {
    mocks.fetchPrForBranch.mockResolvedValueOnce({ pr: makePr({ number: 1 }) });
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);

    await expect(service.getStatus(WORKSPACE_ID)).resolves.toEqual({ pr: makePr({ number: 1 }) });
    await expect(service.getStatus(WORKSPACE_ID)).resolves.toEqual({ pr: makePr({ number: 1 }) });

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

    await expect(service.getStatus(WORKSPACE_ID)).resolves.toEqual({ pr: makePr({ number: 1 }) });
    now += 15_001;
    await expect(service.getStatus(WORKSPACE_ID)).resolves.toEqual({ pr: makePr({ number: 2 }) });

    expect(mocks.fetchPrForBranch).toHaveBeenCalledTimes(2);
    nowSpy.mockRestore();
  });

  it("does not replace a cached PR with a transient fetch error on the same branch", async () => {
    mocks.fetchPrForBranch
      .mockResolvedValueOnce({ pr: makePr({ number: 7 }) })
      .mockResolvedValueOnce({ pr: null, error: "gh unavailable" });
    let now = 100_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);

    await service.getStatus(WORKSPACE_ID);
    now += 15_001;

    await expect(service.getStatus(WORKSPACE_ID)).resolves.toEqual({ pr: makePr({ number: 7 }) });
    expect(mocks.fetchPrForBranch).toHaveBeenCalledTimes(2);

    now += 1_000;
    await expect(service.getStatus(WORKSPACE_ID)).resolves.toEqual({ pr: makePr({ number: 7 }) });
    expect(mocks.fetchPrForBranch).toHaveBeenCalledTimes(2);
    nowSpy.mockRestore();
  });

  it("invalidates cached PR status explicitly", async () => {
    mocks.fetchPrForBranch
      .mockResolvedValueOnce({ pr: makePr({ number: 1 }) })
      .mockResolvedValueOnce({ pr: makePr({ number: 2 }) });
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);

    await service.getStatus(WORKSPACE_ID);
    service.invalidate(WORKSPACE_ID);
    await expect(service.getStatus(WORKSPACE_ID)).resolves.toEqual({ pr: makePr({ number: 2 }) });

    expect(mocks.fetchPrForBranch).toHaveBeenCalledTimes(2);
    nowSpy.mockRestore();
  });

  it("uses provided branch context without loading workspace state", async () => {
    await expect(service.refreshStatus(WORKSPACE_ID, {
      projectUrl: "https://github.com/acme/widget",
      branch: "feature/context",
    })).resolves.toMatchObject({ status: { pr: makePr() } });

    expect(mocks.getWorkspace).not.toHaveBeenCalled();
    expect(mocks.getBranchName).not.toHaveBeenCalled();
    expect(mocks.fetchPrForBranch).toHaveBeenCalledWith("acme", "widget", "feature/context");
  });
});
