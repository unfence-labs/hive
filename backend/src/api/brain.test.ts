import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { brainRoutes } from "./brain.js";
import { createTempDir, createFixtureRepo } from "../utils/test-helpers.js";
import { git } from "../utils/git.js";
import { brainRepoPath } from "../utils/paths.js";

let tempDir: string;
let dataDir: string;

beforeEach(async () => {
  tempDir = await createTempDir("hive-brain-api-test-");
  dataDir = join(tempDir, "data");
  await mkdir(dataDir, { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function buildTestApp() {
  const app = Fastify();
  await app.register((instance) => brainRoutes(instance, dataDir));
  return app;
}

describe("brain routes", () => {
  it("GET /api/brain returns an empty state before setup", async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/api/brain" });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ exists: false });
  });

  it("POST /api/brain connects to an existing local origin", async () => {
    const fixtureDir = join(tempDir, "fixtures");
    await mkdir(fixtureDir, { recursive: true });
    const origin = await createFixtureRepo(fixtureDir);
    const app = await buildTestApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/brain",
      payload: { mode: "connect", url: origin },
    });
    await app.close();

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      exists: true,
      repoUrl: origin,
      createdAt: expect.any(String),
    });
    expect(existsSync(join(brainRepoPath(dataDir), ".git"))).toBe(true);
  });

  it("POST /api/brain returns 409 when a Brain already exists", async () => {
    const fixtureDir = join(tempDir, "fixtures");
    await mkdir(fixtureDir, { recursive: true });
    const origin = await createFixtureRepo(fixtureDir);
    const app = await buildTestApp();

    await app.inject({
      method: "POST",
      url: "/api/brain",
      payload: { mode: "connect", url: origin },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/brain",
      payload: { mode: "connect", url: origin },
    });
    await app.close();

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("Brain already exists");
  });

  it("file routes return 409 when no Brain is connected", async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/api/brain/files" });
    await app.close();
    expect(res.statusCode).toBe(409);
  });

  it("file upsert/read/list + git status/diff/save round-trip", async () => {
    const fixtureDir = join(tempDir, "fixtures");
    await mkdir(fixtureDir, { recursive: true });
    const origin = await createFixtureRepo(fixtureDir);
    const app = await buildTestApp();

    await app.inject({
      method: "POST",
      url: "/api/brain",
      payload: { mode: "connect", url: origin },
    });
    // Committer identity for the local clone.
    await git(["config", "user.email", "test@hive.dev"], brainRepoPath(dataDir));
    await git(["config", "user.name", "Hive Test"], brainRepoPath(dataDir));

    // Upsert a new file (working tree only).
    const putRes = await app.inject({
      method: "PUT",
      url: "/api/brain/file",
      payload: { path: "notes/idea.md", content: "# Idea\n" },
    });
    expect(putRes.statusCode).toBe(200);

    // Read it back.
    const getRes = await app.inject({
      method: "GET",
      url: "/api/brain/file?path=notes/idea.md",
    });
    expect(getRes.json()).toEqual({ path: "notes/idea.md", content: "# Idea\n" });

    // List shows the new directory + file.
    const listRes = await app.inject({ method: "GET", url: "/api/brain/files" });
    const tree = listRes.json() as Array<{ name: string; type: string }>;
    expect(tree.some((n) => n.name === "notes" && n.type === "directory")).toBe(true);

    // Status reflects the untracked file.
    const statusRes = await app.inject({ method: "GET", url: "/api/brain/status" });
    expect(statusRes.json().count).toBe(1);
    expect(statusRes.json().files[0]).toMatchObject({
      path: "notes/idea.md",
      status: "untracked",
    });

    // Diff includes the new file.
    const diffRes = await app.inject({ method: "GET", url: "/api/brain/diff" });
    expect(diffRes.json().diff).toContain("notes/idea.md");

    // Save commits + pushes.
    const saveRes = await app.inject({
      method: "POST",
      url: "/api/brain/save",
      payload: { message: "Add idea" },
    });
    expect(saveRes.json()).toEqual({ committed: true, pushed: true });

    // Nothing left to commit afterwards.
    const cleanStatus = await app.inject({ method: "GET", url: "/api/brain/status" });
    expect(cleanStatus.json().count).toBe(0);

    const saveAgain = await app.inject({
      method: "POST",
      url: "/api/brain/save",
      payload: {},
    });
    expect(saveAgain.json()).toEqual({ committed: false, pushed: false });

    await app.close();
  });

  it("DELETE /api/brain removes state and clone", async () => {
    const fixtureDir = join(tempDir, "fixtures");
    await mkdir(fixtureDir, { recursive: true });
    const origin = await createFixtureRepo(fixtureDir);
    const app = await buildTestApp();

    await app.inject({
      method: "POST",
      url: "/api/brain",
      payload: { mode: "connect", url: origin },
    });
    expect(existsSync(brainRepoPath(dataDir))).toBe(true);

    const res = await app.inject({ method: "DELETE", url: "/api/brain" });
    const getRes = await app.inject({ method: "GET", url: "/api/brain" });
    await app.close();

    expect(res.statusCode).toBe(204);
    expect(existsSync(brainRepoPath(dataDir))).toBe(false);
    expect(getRes.json()).toEqual({ exists: false });
  });
});
