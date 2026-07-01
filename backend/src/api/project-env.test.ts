import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "../utils/test-helpers.js";
import { saveProject } from "../state/state.js";
import { projectEnvRoutes } from "./project-env.js";
import type { ProjectEnvConfig, ProjectState } from "../types.js";

let tempDir: string;
let dataDir: string;
let app: ReturnType<typeof Fastify>;

const project: ProjectState = {
  id: "proj-1",
  name: "Alpha",
  url: "https://github.com/acme/alpha.git",
  createdAt: "2026-05-12T00:00:00.000Z",
  workspaces: [],
};

beforeEach(async () => {
  tempDir = await createTempDir("hive-project-env-api-test-");
  dataDir = join(tempDir, "data");
  await mkdir(dataDir, { recursive: true });
  await saveProject(project, dataDir);

  app = Fastify();
  await app.register((instance: FastifyInstance) => projectEnvRoutes(instance, dataDir));
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("project environment routes", () => {
  it("returns not configured by default", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/proj-1/env" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.json()).toEqual({ exists: false, config: { variables: [] } });
  });

  it("saves and returns project environment config", async () => {
    const config = envConfig("API_KEY", "secret");
    const put = await app.inject({
      method: "PUT",
      url: "/api/projects/proj-1/env",
      payload: { config },
    });

    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({
      exists: true,
      config,
      path: join(dataDir, "proj-1", "env", "env.json"),
    });

    const get = await app.inject({ method: "GET", url: "/api/projects/proj-1/env" });
    expect(get.json().config).toEqual(config);
    expect(get.json().path).toBe(join(dataDir, "proj-1", "env", "env.json"));
  });

  it("returns 404 for unknown projects", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/missing/env" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Project not found" });
  });

  it("validates request config", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/projects/proj-1/env",
      payload: { config: 123 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Config is required" });
  });

  it("rejects invalid variable keys", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/projects/proj-1/env",
      payload: { config: envConfig("API KEY", "secret") },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("not a valid environment variable key");
  });

  it("rejects variable values with line breaks", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/projects/proj-1/env",
      payload: { config: envConfig("API_KEY", "one\ntwo") },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("value cannot contain line breaks");
  });
});

function envConfig(key: string, value: string): ProjectEnvConfig {
  return {
    variables: [{ id: "var-1", key, value }],
  };
}
