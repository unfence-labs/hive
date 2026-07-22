import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir, createFixtureRepo } from "../utils/test-helpers.js";
import { projectRoutes } from "./projects.js";
import { workspaceRoutes } from "./workspaces.js";
import { workspaceSourceRoutes } from "./workspace-sources.js";
import { git } from "../utils/git.js";
import { loadProject, saveProject } from "../state/state.js";
import { fetchPrDetail, fetchIssueDetail, listOpenPullRequests, listOpenIssues } from "../utils/github.js";

vi.mock("../utils/github.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/github.js")>();
  return {
    ...actual,
    fetchPrDetail: vi.fn(),
    fetchIssueDetail: vi.fn(),
    listOpenPullRequests: vi.fn(),
    listOpenIssues: vi.fn(),
  };
});

let tempDir: string;
let dataDir: string;
let fixtureRepoUrl: string;
let app: ReturnType<typeof Fastify>;
let projectId: string;

async function setProjectGitHubUrl(): Promise<void> {
  const state = await loadProject(projectId, dataDir);
  state!.url = "git@github.com:acme/demo.git";
  await saveProject(state!, dataDir);
}

async function createFromSource(source: unknown) {
  return app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/workspaces`,
    payload: { source },
  });
}

beforeEach(async () => {
  vi.mocked(fetchPrDetail).mockReset();
  vi.mocked(fetchIssueDetail).mockReset();
  vi.mocked(listOpenPullRequests).mockReset();
  vi.mocked(listOpenIssues).mockReset();

  tempDir = await createTempDir("hive-api-ws-from-test-");
  dataDir = join(tempDir, "data");
  const fixtureDir = join(tempDir, "fixtures");
  await mkdir(dataDir, { recursive: true });
  await mkdir(fixtureDir, { recursive: true });
  fixtureRepoUrl = await createFixtureRepo(fixtureDir);

  app = Fastify();
  await app.register((instance: FastifyInstance) => projectRoutes(instance, dataDir));
  await app.register((instance: FastifyInstance) => workspaceRoutes(instance, dataDir));
  await app.register((instance: FastifyInstance) => workspaceSourceRoutes(instance, dataDir));
  await app.ready();

  const res = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: { url: fixtureRepoUrl },
  });
  projectId = res.json().id;

  // A remote branch that exists on origin but not in the project's bare clone.
  await git(["branch", "feature-x", "main"], fixtureRepoUrl);
});

afterEach(async () => {
  await app.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("POST /api/projects/:id/workspaces with source kind 'branch'", () => {
  it("checks out an existing remote branch", async () => {
    const res = await createFromSource({ kind: "branch", branch: "feature-x" });
    expect(res.statusCode).toBe(201);
    const ws = res.json();
    expect(ws.branch).toBe("feature-x");
    expect(ws.source).toEqual({ kind: "branch", branch: "feature-x" });
    expect(ws.draftPrompt).toBeUndefined();

    const wsPath = join(dataDir, projectId, "workspaces", ws.name);
    const { stdout } = await git(["rev-parse", "--abbrev-ref", "HEAD"], wsPath);
    expect(stdout).toBe("feature-x");
  });

  it("returns 409 when the branch is already checked out in another workspace", async () => {
    const first = await createFromSource({ kind: "branch", branch: "feature-x" });
    expect(first.statusCode).toBe(201);
    const res = await createFromSource({ kind: "branch", branch: "feature-x" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain(first.json().name);
  });

  it("returns 400 for an unknown branch", async () => {
    const res = await createFromSource({ kind: "branch", branch: "does-not-exist" });
    expect(res.statusCode).toBe(400);
  });

  it("rejects option-like branch names", async () => {
    const res = await createFromSource({ kind: "branch", branch: "--force" });
    expect(res.statusCode).toBe(400);
  });

  it("keeps the branch in the bare repo when the workspace is deleted", async () => {
    const created = await createFromSource({ kind: "branch", branch: "feature-x" });
    const ws = created.json();
    const res = await app.inject({ method: "DELETE", url: `/api/workspaces/${ws.id}` });
    expect(res.statusCode).toBe(204);
    const bare = join(dataDir, projectId, "repo.git");
    await expect(git(["show-ref", "--verify", "refs/heads/feature-x"], bare)).resolves.toBeTruthy();
  });
});

describe("POST /api/projects/:id/workspaces with source kind 'pr'", () => {
  it("checks out the PR head branch and seeds a draft prompt", async () => {
    await setProjectGitHubUrl();
    vi.mocked(fetchPrDetail).mockResolvedValue({
      number: 12,
      title: "Fix streaming",
      body: "Steps and details",
      url: "https://github.com/acme/demo/pull/12",
      headRefName: "feature-x",
      isCrossRepository: false,
    });

    const res = await createFromSource({ kind: "pr", number: 12 });
    expect(res.statusCode).toBe(201);
    const ws = res.json();
    expect(ws.branch).toBe("feature-x");
    expect(ws.source).toEqual({
      kind: "pr",
      branch: "feature-x",
      number: 12,
      title: "Fix streaming",
      url: "https://github.com/acme/demo/pull/12",
    });
    expect(ws.draftPrompt).toContain("pull request #12");
    expect(ws.draftPrompt).toContain("Steps and details");
  });

  it("checks out a cross-repository PR via refs/pull/<n>/head", async () => {
    await setProjectGitHubUrl();
    const { stdout: sha } = await git(["rev-parse", "main"], fixtureRepoUrl);
    await git(["update-ref", "refs/pull/7/head", sha], fixtureRepoUrl);
    vi.mocked(fetchPrDetail).mockResolvedValue({
      number: 7,
      title: "Fork contribution",
      body: "",
      url: "https://github.com/acme/demo/pull/7",
      headRefName: "fork-feature",
      isCrossRepository: true,
    });

    const res = await createFromSource({ kind: "pr", number: 7 });
    expect(res.statusCode).toBe(201);
    const ws = res.json();
    expect(ws.branch).toBe("pr/7");
    const wsPath = join(dataDir, projectId, "workspaces", ws.name);
    const { stdout } = await git(["rev-parse", "--abbrev-ref", "HEAD"], wsPath);
    expect(stdout).toBe("pr/7");
  });

  it("does not move an existing local branch when a fork PR reuses its name", async () => {
    await setProjectGitHubUrl();
    const bare = join(dataDir, projectId, "repo.git");
    const { stdout: mainShaBefore } = await git(["rev-parse", "refs/heads/main"], bare);

    const { stdout: sha } = await git(["rev-parse", "main"], fixtureRepoUrl);
    await git(["update-ref", "refs/pull/9/head", sha], fixtureRepoUrl);
    vi.mocked(fetchPrDetail).mockResolvedValue({
      number: 9,
      title: "Fork reuses main",
      body: "",
      url: "https://github.com/acme/demo/pull/9",
      headRefName: "main",
      isCrossRepository: true,
    });

    const res = await createFromSource({ kind: "pr", number: 9 });
    expect(res.statusCode).toBe(201);
    const ws = res.json();
    expect(ws.branch).toBe("pr/9");

    const { stdout: mainShaAfter } = await git(["rev-parse", "refs/heads/main"], bare);
    expect(mainShaAfter).toBe(mainShaBefore);
  });

  it("deletes the pr/<n> branch when the workspace is deleted", async () => {
    await setProjectGitHubUrl();
    const { stdout: sha } = await git(["rev-parse", "main"], fixtureRepoUrl);
    await git(["update-ref", "refs/pull/11/head", sha], fixtureRepoUrl);
    vi.mocked(fetchPrDetail).mockResolvedValue({
      number: 11,
      title: "Fork contribution",
      body: "",
      url: "https://github.com/acme/demo/pull/11",
      headRefName: "fork-feature",
      isCrossRepository: true,
    });

    const created = await createFromSource({ kind: "pr", number: 11 });
    expect(created.statusCode).toBe(201);
    const ws = created.json();
    expect(ws.branch).toBe("pr/11");

    const res = await app.inject({ method: "DELETE", url: `/api/workspaces/${ws.id}` });
    expect(res.statusCode).toBe(204);

    const bare = join(dataDir, projectId, "repo.git");
    await expect(git(["show-ref", "--verify", "refs/heads/pr/11"], bare)).rejects.toBeTruthy();
  });

  it("returns 400 when the project has no GitHub remote", async () => {
    const res = await createFromSource({ kind: "pr", number: 12 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("GitHub");
  });
});

describe("POST /api/projects/:id/workspaces with source kind 'issue'", () => {
  it("branches from the default branch and seeds a draft prompt", async () => {
    await setProjectGitHubUrl();
    vi.mocked(fetchIssueDetail).mockResolvedValue({
      number: 45,
      title: "Sidebar flickers",
      body: "Repro steps",
      url: "https://github.com/acme/demo/issues/45",
    });

    const res = await createFromSource({ kind: "issue", number: 45 });
    expect(res.statusCode).toBe(201);
    const ws = res.json();
    expect(ws.branch).toMatch(/^workspace\//);
    expect(ws.source).toEqual({
      kind: "issue",
      number: 45,
      title: "Sidebar flickers",
      url: "https://github.com/acme/demo/issues/45",
    });
    expect(ws.draftPrompt).toContain("issue #45");
    expect(ws.draftPrompt).toContain("Repro steps");
  });
});

describe("POST /api/projects/:id/workspaces body validation", () => {
  it("still creates a default workspace with no body", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/workspaces`,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().branch).toMatch(/^workspace\//);
    expect(res.json().source).toBeUndefined();
  });

  it("rejects an invalid source kind", async () => {
    const res = await createFromSource({ kind: "tag", name: "v1" });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a pr source without a number", async () => {
    const res = await createFromSource({ kind: "pr" });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/projects/:id/branches", () => {
  it("lists remote branches without the default branch", async () => {
    const res = await app.inject({ method: "GET", url: `/api/projects/${projectId}/branches` });
    expect(res.statusCode).toBe(200);
    const names = res.json().branches.map((b: { name: string }) => b.name);
    expect(names).toContain("feature-x");
    expect(names).not.toContain("main");
  });

  it("annotates branches already checked out in a workspace", async () => {
    const created = await createFromSource({ kind: "branch", branch: "feature-x" });
    const ws = created.json();
    const res = await app.inject({ method: "GET", url: `/api/projects/${projectId}/branches` });
    const branch = res.json().branches.find((b: { name: string }) => b.name === "feature-x");
    expect(branch.workspaceId).toBe(ws.id);
    expect(branch.workspaceName).toBe(ws.name);
  });

  it("returns 404 for a non-existent project", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/nonexistent/branches" });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/projects/:id/pulls", () => {
  it("returns pulls annotated with existing workspaces", async () => {
    await setProjectGitHubUrl();
    const created = await createFromSource({ kind: "branch", branch: "feature-x" });
    const ws = created.json();
    vi.mocked(listOpenPullRequests).mockResolvedValue([
      { number: 12, title: "Fix streaming", url: "u12", headRefName: "feature-x", isDraft: false, author: "flo" },
      { number: 13, title: "Docs", url: "u13", headRefName: "docs", isDraft: true, author: "sam" },
    ]);

    const res = await app.inject({ method: "GET", url: `/api/projects/${projectId}/pulls` });
    expect(res.statusCode).toBe(200);
    const { pulls } = res.json();
    expect(pulls).toHaveLength(2);
    expect(pulls[0]).toMatchObject({ number: 12, branch: "feature-x", workspaceId: ws.id });
    expect(pulls[1].workspaceId).toBeUndefined();
  });

  it("degrades to an error field when the project has no GitHub remote", async () => {
    const res = await app.inject({ method: "GET", url: `/api/projects/${projectId}/pulls` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ pulls: [], error: "This project has no GitHub remote" });
  });

  it("degrades to an error field when gh fails", async () => {
    await setProjectGitHubUrl();
    vi.mocked(listOpenPullRequests).mockRejectedValue(new Error("gh not authenticated"));
    const res = await app.inject({ method: "GET", url: `/api/projects/${projectId}/pulls` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ pulls: [], error: "gh not authenticated" });
  });
});

describe("GET /api/projects/:id/issues", () => {
  it("returns open issues", async () => {
    await setProjectGitHubUrl();
    vi.mocked(listOpenIssues).mockResolvedValue([
      { number: 45, title: "Sidebar flickers", url: "u45", author: "flo" },
    ]);
    const res = await app.inject({ method: "GET", url: `/api/projects/${projectId}/issues` });
    expect(res.statusCode).toBe(200);
    expect(res.json().issues).toEqual([
      { number: 45, title: "Sidebar flickers", url: "u45", author: "flo" },
    ]);
  });

  it("degrades to an error field when the project has no GitHub remote", async () => {
    const res = await app.inject({ method: "GET", url: `/api/projects/${projectId}/issues` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ issues: [], error: "This project has no GitHub remote" });
  });
});
