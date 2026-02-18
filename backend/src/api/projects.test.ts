import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { rm, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createTempDir, createFixtureRepo } from "../utils/test-helpers.js";
import { git } from "../utils/git.js";
import { projectRoutes } from "./projects.js";
import { workspaceRoutes } from "./workspaces.js";

let tempDir: string;
let dataDir: string;
let fixtureRepoUrl: string;
let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  tempDir = await createTempDir("hive-api-proj-test-");
  dataDir = join(tempDir, "data");
  const fixtureDir = join(tempDir, "fixtures");
  await mkdir(dataDir, { recursive: true });
  await mkdir(fixtureDir, { recursive: true });
  fixtureRepoUrl = await createFixtureRepo(fixtureDir);

  app = Fastify();
  await app.register((instance: FastifyInstance) => projectRoutes(instance, dataDir));
  await app.register((instance: FastifyInstance) => workspaceRoutes(instance, dataDir));
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(tempDir, { recursive: true, force: true });
});

async function createFixtureRepoWithFile(
  baseDir: string,
  filePath: string,
  fileContent: string | Buffer,
): Promise<string> {
  const repoId = Math.random().toString(36).slice(2);
  const workDir = join(baseDir, `fixture-work-${repoId}`);
  const bareDir = join(baseDir, `fixture-${repoId}.git`);

  await git(["init", workDir]);
  await git(["checkout", "-b", "main"], workDir);
  await git(["config", "user.email", "test@hive.dev"], workDir);
  await git(["config", "user.name", "Hive Test"], workDir);

  await writeFile(join(workDir, "README.md"), "# Test Repo\n");
  const absoluteFilePath = join(workDir, filePath);
  await mkdir(dirname(absoluteFilePath), { recursive: true });
  await writeFile(absoluteFilePath, fileContent);

  await git(["add", "."], workDir);
  await git(["commit", "-m", "initial commit with file"], workDir);
  await git(["clone", "--bare", workDir, bareDir]);
  return bareDir;
}

describe("POST /api/projects", () => {
  it("creates a project and returns 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { url: fixtureRepoUrl },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toMatch(/^proj-/);
    expect(body.name).toBe("fixture");
  });

  it("returns 400 for missing url", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for disallowed file:// url", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { url: "file:///tmp/repo.git" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("not allowed");
  });
});

describe("GET /api/projects", () => {
  it("returns empty array initially", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("returns created projects", async () => {
    await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { url: fixtureRepoUrl },
    });
    const res = await app.inject({ method: "GET", url: "/api/projects" });
    expect(res.json()).toHaveLength(1);
  });

  it("returns hasFavicon=false when project repo has no favicon", async () => {
    await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { url: fixtureRepoUrl },
    });
    const res = await app.inject({ method: "GET", url: "/api/projects" });
    const [project] = res.json();
    expect(project.hasFavicon).toBe(false);
  });

  it("returns sessionCount=0 for workspaces with no sessions", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { url: fixtureRepoUrl },
    });
    const { id } = createRes.json();

    // Create a workspace
    await app.inject({ method: "POST", url: `/api/projects/${id}/workspaces` });

    const res = await app.inject({ method: "GET", url: "/api/projects" });
    const [project] = res.json();
    expect(project.workspaces).toHaveLength(1);
    expect(project.workspaces[0].sessionCount).toBe(0);
  });

  it("returns correct sessionCount per workspace", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { url: fixtureRepoUrl },
    });
    const { id } = createRes.json();

    // Create two workspaces
    const ws1Res = await app.inject({ method: "POST", url: `/api/projects/${id}/workspaces` });
    const ws2Res = await app.inject({ method: "POST", url: `/api/projects/${id}/workspaces` });
    const ws1Id = ws1Res.json().id;
    const ws2Id = ws2Res.json().id;

    // Write session fixtures directly on disk
    const sessionsRoot = join(dataDir, id, "sessions");
    for (const [sessId, wsId] of [
      ["sess-a", ws1Id],
      ["sess-b", ws1Id],
      ["sess-c", ws1Id],
      ["sess-d", ws2Id],
    ]) {
      const dir = join(sessionsRoot, sessId);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "metadata.json"), JSON.stringify({ sessionId: sessId, workspaceId: wsId }));
    }

    const res = await app.inject({ method: "GET", url: "/api/projects" });
    const [project] = res.json();
    const countByWs = Object.fromEntries(project.workspaces.map((ws: { id: string; sessionCount: number }) => [ws.id, ws.sessionCount]));
    expect(countByWs[ws1Id]).toBe(3);
    expect(countByWs[ws2Id]).toBe(1);
  });

  it("returns hasFavicon=true when project repo contains a favicon", async () => {
    const fixtureDir = join(tempDir, "fixtures");
    const repoWithFavicon = await createFixtureRepoWithFile(
      fixtureDir,
      "public/favicon.svg",
      "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
    );

    await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { url: repoWithFavicon },
    });

    const res = await app.inject({ method: "GET", url: "/api/projects" });
    const [project] = res.json();
    expect(project.hasFavicon).toBe(true);
  });
});

describe("GET /api/projects/:id", () => {
  it("returns project details", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { url: fixtureRepoUrl },
    });
    const { id } = createRes.json();
    const res = await app.inject({ method: "GET", url: `/api/projects/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(id);
    expect(res.json()).toHaveProperty("hasFavicon");
  });

  it("returns 404 for non-existent project", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/nonexistent" });
    expect(res.statusCode).toBe(404);
  });

  it("returns hasFavicon=true for a project with nested favicon", async () => {
    const fixtureDir = join(tempDir, "fixtures");
    const repoWithFavicon = await createFixtureRepoWithFile(
      fixtureDir,
      "apps/web/favicon.png",
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]),
    );

    const createRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { url: repoWithFavicon },
    });
    const { id } = createRes.json();

    const res = await app.inject({ method: "GET", url: `/api/projects/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().hasFavicon).toBe(true);
  });
});

describe("DELETE /api/projects/:id", () => {
  it("deletes a project and returns 204", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { url: fixtureRepoUrl },
    });
    const { id } = createRes.json();
    const res = await app.inject({ method: "DELETE", url: `/api/projects/${id}` });
    expect(res.statusCode).toBe(204);

    const getRes = await app.inject({ method: "GET", url: `/api/projects/${id}` });
    expect(getRes.statusCode).toBe(404);
  });

  it("returns 404 for non-existent project", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/projects/nonexistent" });
    expect(res.statusCode).toBe(404);
  });

  it("returns 409 when project has active workspaces", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { url: fixtureRepoUrl },
    });
    const { id } = createRes.json();
    await app.inject({ method: "POST", url: `/api/projects/${id}/workspaces` });
    const res = await app.inject({ method: "DELETE", url: `/api/projects/${id}` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("active workspaces");
  });
});

describe("POST /api/projects/:id/fetch", () => {
  it("fetches successfully", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { url: fixtureRepoUrl },
    });
    const { id } = createRes.json();
    const res = await app.inject({ method: "POST", url: `/api/projects/${id}/fetch` });
    expect(res.statusCode).toBe(200);
  });

  it("returns 404 for non-existent project", async () => {
    const res = await app.inject({ method: "POST", url: "/api/projects/nonexistent/fetch" });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/projects/:id/favicon", () => {
  it("returns favicon binary content with mime type and cache headers", async () => {
    const fixtureDir = join(tempDir, "fixtures");
    const faviconBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
    const repoWithFavicon = await createFixtureRepoWithFile(
      fixtureDir,
      "assets/favicon.png",
      faviconBytes,
    );

    const createRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { url: repoWithFavicon },
    });
    const { id } = createRes.json();

    const res = await app.inject({ method: "GET", url: `/api/projects/${id}/favicon` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.headers["cache-control"]).toBe("public, max-age=3600");
    expect(Buffer.compare(res.rawPayload, faviconBytes)).toBe(0);
  });

  it("returns 404 when no favicon exists", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { url: fixtureRepoUrl },
    });
    const { id } = createRes.json();

    const res = await app.inject({ method: "GET", url: `/api/projects/${id}/favicon` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain("No favicon found");
  });

  it("returns 404 for non-existent project", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/nonexistent/favicon" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain("Project not found");
  });
});
