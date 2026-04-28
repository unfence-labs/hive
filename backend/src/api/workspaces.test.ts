import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir, createFixtureRepo } from "../utils/test-helpers.js";
import { projectRoutes } from "./projects.js";
import { workspaceRoutes } from "./workspaces.js";
import { git } from "../utils/git.js";
import { loadProject, saveProject } from "../state/state.js";

let tempDir: string;
let dataDir: string;
let fixtureRepoUrl: string;
let app: ReturnType<typeof Fastify>;
let projectId: string;

beforeEach(async () => {
  tempDir = await createTempDir("hive-api-ws-test-");
  dataDir = join(tempDir, "data");
  const fixtureDir = join(tempDir, "fixtures");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dataDir, { recursive: true });
  await mkdir(fixtureDir, { recursive: true });
  fixtureRepoUrl = await createFixtureRepo(fixtureDir);

  app = Fastify();
  await app.register((instance: FastifyInstance) => projectRoutes(instance, dataDir));
  await app.register((instance: FastifyInstance) => workspaceRoutes(instance, dataDir));
  await app.ready();

  const res = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: { url: fixtureRepoUrl },
  });
  projectId = res.json().id;
});

afterEach(async () => {
  await app.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("POST /api/projects/:id/workspaces", () => {
  it("creates a workspace and returns 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/workspaces`,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBeTruthy();
    expect(body.branch).toMatch(/^workspace\//);
    expect(body.status).toBe("idle");
  });

  it("returns 404 for non-existent project", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/nonexistent/workspaces",
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/projects/:id/workspaces", () => {
  it("lists workspaces", async () => {
    await app.inject({ method: "POST", url: `/api/projects/${projectId}/workspaces` });
    await app.inject({ method: "POST", url: `/api/projects/${projectId}/workspaces` });
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/workspaces`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });
});

describe("GET /api/workspaces/:wsId", () => {
  it("returns workspace detail", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/workspaces`,
    });
    const createdWorkspace = createRes.json();
    const wsId = createdWorkspace.id;
    const res = await app.inject({ method: "GET", url: `/api/workspaces/${wsId}` });
    const project = await loadProject(projectId, dataDir);
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(wsId);
    expect(res.json().projectName).toBe(project?.name);
    expect(res.json().defaultBranch).toBe("main");
    expect(res.json().worktreePath).toBe(join(dataDir, projectId, "workspaces", createdWorkspace.name));
  });

  it("returns 404 for non-existent workspace", async () => {
    const res = await app.inject({ method: "GET", url: "/api/workspaces/nonexistent" });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/workspaces/:wsId/files", () => {
  it("returns 404 for non-existent workspace", async () => {
    const res = await app.inject({ method: "GET", url: "/api/workspaces/nonexistent/files" });
    expect(res.statusCode).toBe(404);
  });

  it("returns nested file tree for workspace", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/workspaces`,
    });
    const ws = createRes.json();
    const wsPath = join(dataDir, projectId, "workspaces", ws.name);

    await mkdir(join(wsPath, "src", "components"), { recursive: true });
    await writeFile(join(wsPath, "src", "components", "Panel.tsx"), "export const Panel = null;\n");
    await writeFile(join(wsPath, "src", "index.ts"), "export * from './components/Panel';\n");

    const res = await app.inject({ method: "GET", url: `/api/workspaces/${ws.id}/files` });
    expect(res.statusCode).toBe(200);

    const tree = res.json();
    expect(Array.isArray(tree)).toBe(true);
    expect(tree).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "README.md", type: "file", path: "README.md" }),
        expect.objectContaining({
          name: "src",
          type: "directory",
          path: "src",
          children: expect.arrayContaining([
            expect.objectContaining({ name: "index.ts", type: "file", path: "src/index.ts" }),
            expect.objectContaining({
              name: "components",
              type: "directory",
              path: "src/components",
              children: expect.arrayContaining([
                expect.objectContaining({
                  name: "Panel.tsx",
                  type: "file",
                  path: "src/components/Panel.tsx",
                }),
              ]),
            }),
          ]),
        }),
      ]),
    );
  });
});

describe("DELETE /api/workspaces/:wsId", () => {
  it("deletes workspace and returns 204", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/workspaces`,
    });
    const wsId = createRes.json().id;
    const res = await app.inject({ method: "DELETE", url: `/api/workspaces/${wsId}` });
    expect(res.statusCode).toBe(204);
  });
});

describe("DELETE /api/workspaces/:wsId", () => {
  it("returns 404 for non-existent workspace", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/workspaces/nonexistent" });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/workspaces/:wsId/diff", () => {
  it("returns 404 for non-existent workspace", async () => {
    const res = await app.inject({ method: "GET", url: "/api/workspaces/nonexistent/diff" });
    expect(res.statusCode).toBe(404);
  });

  it("returns diff", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/workspaces`,
    });
    const ws = createRes.json();

    // Make a change in the worktree
    const wsPath = join(dataDir, projectId, "workspaces", ws.name);
    await writeFile(join(wsPath, "api-test.txt"), "api test content\n");
    await git(["add", "."], wsPath);
    await git(["config", "user.email", "test@hive.dev"], wsPath);
    await git(["config", "user.name", "Test"], wsPath);
    await git(["commit", "-m", "api test change"], wsPath);

    const res = await app.inject({ method: "GET", url: `/api/workspaces/${ws.id}/diff` });
    expect(res.statusCode).toBe(200);
    expect(res.json().diff).toContain("api-test.txt");
  });

  it("returns scoped diffs", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/workspaces`,
    });
    const ws = createRes.json();
    const wsPath = join(dataDir, projectId, "workspaces", ws.name);

    await writeFile(join(wsPath, "committed.txt"), "committed\n");
    await git(["add", "."], wsPath);
    await git(["config", "user.email", "test@hive.dev"], wsPath);
    await git(["config", "user.name", "Test"], wsPath);
    await git(["commit", "-m", "api committed change"], wsPath);
    await writeFile(join(wsPath, "README.md"), "local only\n");

    const committedRes = await app.inject({
      method: "GET",
      url: `/api/workspaces/${ws.id}/diff?scope=committed`,
    });
    const uncommittedRes = await app.inject({
      method: "GET",
      url: `/api/workspaces/${ws.id}/diff?scope=uncommitted`,
    });

    expect(committedRes.statusCode).toBe(200);
    expect(committedRes.json().diff).toContain("committed.txt");
    expect(committedRes.json().diff).not.toContain("README.md");
    expect(uncommittedRes.statusCode).toBe(200);
    expect(uncommittedRes.json().diff).not.toContain("committed.txt");
    expect(uncommittedRes.json().diff).toContain("README.md");
  });

  it("rejects invalid diff scopes", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/workspaces`,
    });
    const ws = createRes.json();

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${ws.id}/diff?scope=everything`,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Invalid diff scope");
  });
});

describe("GET /api/workspaces/:wsId/diff/stat", () => {
  it("returns 404 for non-existent workspace", async () => {
    const res = await app.inject({ method: "GET", url: "/api/workspaces/nonexistent/diff/stat" });
    expect(res.statusCode).toBe(404);
  });

  it("returns committed and uncommitted diff stats", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/workspaces`,
    });
    const ws = createRes.json();

    const wsPath = join(dataDir, projectId, "workspaces", ws.name);
    await writeFile(join(wsPath, "stat-test.txt"), "line1\nline2\n");
    await git(["add", "."], wsPath);
    await git(["config", "user.email", "test@hive.dev"], wsPath);
    await git(["config", "user.name", "Test"], wsPath);
    await git(["commit", "-m", "stat test"], wsPath);

    const res = await app.inject({ method: "GET", url: `/api/workspaces/${ws.id}/diff/stat` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("committed");
    expect(body).toHaveProperty("uncommitted");
    expect(Array.isArray(body.committed)).toBe(true);
    expect(body.committed.length).toBeGreaterThanOrEqual(1);
    const file = body.committed.find((s: { file: string }) => s.file === "stat-test.txt");
    expect(file).toBeDefined();
    expect(file.additions).toBe(2);
    expect(file.status).toBe("added");
    expect(body.uncommitted).toEqual([]);
  });

  it("returns renamed file status and source path", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/workspaces`,
    });
    const ws = createRes.json();

    const wsPath = join(dataDir, projectId, "workspaces", ws.name);
    await git(["mv", "README.md", "README-renamed.md"], wsPath);
    await git(["config", "user.email", "test@hive.dev"], wsPath);
    await git(["config", "user.name", "Test"], wsPath);
    await git(["commit", "-m", "rename readme"], wsPath);

    const res = await app.inject({ method: "GET", url: `/api/workspaces/${ws.id}/diff/stat` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const renamed = body.committed.find(
      (s: { file: string }) => s.file === "README-renamed.md",
    );
    expect(renamed).toBeDefined();
    expect(renamed.status).toBe("renamed");
    expect(renamed.renamedFrom).toBe("README.md");
  });
});

describe("POST /api/workspaces/:wsId/merge", () => {
  it("merges workspace and returns success", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/workspaces`,
    });
    const ws = createRes.json();

    const wsPath = join(dataDir, projectId, "workspaces", ws.name);
    await writeFile(join(wsPath, "merge-test.txt"), "merge content\n");
    await git(["add", "."], wsPath);
    await git(["config", "user.email", "test@hive.dev"], wsPath);
    await git(["config", "user.name", "Test"], wsPath);
    await git(["commit", "-m", "merge test"], wsPath);

    const res = await app.inject({ method: "POST", url: `/api/workspaces/${ws.id}/merge` });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("merged");
  });

  it("returns 404 for non-existent workspace", async () => {
    const res = await app.inject({ method: "POST", url: "/api/workspaces/nonexistent/merge" });
    expect(res.statusCode).toBe(404);
  });

  it("returns 409 when workspace is busy", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/workspaces`,
    });
    const ws = createRes.json();

    // Set workspace to busy
    const state = await loadProject(projectId, dataDir);
    const workspace = state!.workspaces.find((w) => w.id === ws.id)!;
    workspace.status = "busy";
    workspace.activeSessionId = "some-session";
    await saveProject(state!, dataDir);

    const res = await app.inject({ method: "POST", url: `/api/workspaces/${ws.id}/merge` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("Cannot merge");
  });
});

describe("POST /api/workspaces/:wsId/archive", () => {
  it("archives workspace and returns 204", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/workspaces`,
    });
    const wsId = createRes.json().id;

    const res = await app.inject({ method: "POST", url: `/api/workspaces/${wsId}/archive` });
    expect(res.statusCode).toBe(204);

    // Workspace should no longer appear in list
    const listRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/workspaces`,
    });
    expect(listRes.json()).toHaveLength(0);
  });

  it("returns 404 for non-existent workspace", async () => {
    const res = await app.inject({ method: "POST", url: "/api/workspaces/nonexistent/archive" });
    expect(res.statusCode).toBe(404);
  });

  it("archived workspace is no longer accessible via GET", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/workspaces`,
    });
    const wsId = createRes.json().id;

    await app.inject({ method: "POST", url: `/api/workspaces/${wsId}/archive` });

    const getRes = await app.inject({ method: "GET", url: `/api/workspaces/${wsId}` });
    expect(getRes.statusCode).toBe(404);
  });

  it("preserves archive data on disk", async () => {
    const { existsSync } = await import("node:fs");
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/workspaces`,
    });
    const ws = createRes.json();

    await app.inject({ method: "POST", url: `/api/workspaces/${ws.id}/archive` });

    const archiveDir = join(dataDir, projectId, "archive", ws.id);
    expect(existsSync(archiveDir)).toBe(true);
    expect(existsSync(join(archiveDir, "workspace.json"))).toBe(true);
  });
});

describe("GET /api/workspaces/:wsId/file", () => {
  it("returns 404 for non-existent workspace", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/workspaces/nonexistent/file?path=README.md",
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 when path query param is missing", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/workspaces`,
    });
    const ws = createRes.json();

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${ws.id}/file`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("path");
  });

  it("returns file content for existing file", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/workspaces`,
    });
    const ws = createRes.json();

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${ws.id}/file?path=README.md`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content).toBe("# Test Repo\n");
    expect(body.path).toBe("README.md");
  });

  it("returns content for a newly created file", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/workspaces`,
    });
    const ws = createRes.json();
    const wsPath = join(dataDir, projectId, "workspaces", ws.name);

    await mkdir(join(wsPath, "src"), { recursive: true });
    await writeFile(join(wsPath, "src", "app.ts"), "const x = 1;\n");

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${ws.id}/file?path=src/app.ts`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().content).toBe("const x = 1;\n");
    expect(res.json().path).toBe("src/app.ts");
  });

  it("returns 404 for non-existent file", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/workspaces`,
    });
    const ws = createRes.json();

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${ws.id}/file?path=does-not-exist.txt`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for directory traversal attempt", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/workspaces`,
    });
    const ws = createRes.json();

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${ws.id}/file?path=../../etc/passwd`,
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when path points to a directory", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/workspaces`,
    });
    const ws = createRes.json();
    const wsPath = join(dataDir, projectId, "workspaces", ws.name);

    await mkdir(join(wsPath, "src"), { recursive: true });

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${ws.id}/file?path=src`,
    });
    expect(res.statusCode).toBe(400);
  });
});
