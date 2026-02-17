import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mocks = vi.hoisted(() => ({
  startScript: vi.fn(),
  stopScript: vi.fn(),
  getScriptStatus: vi.fn(),
}));

vi.mock("../services/script-runner.js", () => ({
  startScript: mocks.startScript,
  stopScript: mocks.stopScript,
  getScriptStatus: mocks.getScriptStatus,
}));

import { scriptRoutes } from "./scripts.js";
import { saveProject } from "../state/state.js";
import type { ProjectState } from "../types.js";

let tempDir: string;
let dataDir: string;
let app: ReturnType<typeof Fastify>;
let wsPath: string;

const PROJECT_ID = "proj-1";
const WS_ID = "ws-1";
const WS_NAME = "tokyo";

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "hive-api-scripts-test-"));
  dataDir = join(tempDir, "data");
  wsPath = join(dataDir, PROJECT_ID, "workspaces", WS_NAME);

  await mkdir(wsPath, { recursive: true });

  const state: ProjectState = {
    id: PROJECT_ID,
    name: "Test Project",
    url: "/tmp/repo.git",
    createdAt: new Date().toISOString(),
    workspaces: [
      {
        id: WS_ID,
        name: WS_NAME,
        projectId: PROJECT_ID,
        branch: "workspace/tokyo",
        status: "idle",
        createdAt: new Date().toISOString(),
      },
    ],
  };
  await saveProject(state, dataDir);

  mocks.startScript.mockReset();
  mocks.stopScript.mockReset();
  mocks.getScriptStatus.mockReset();
  mocks.getScriptStatus.mockReturnValue({
    setup: { state: "idle" },
    run: { state: "idle" },
  });
  mocks.stopScript.mockReturnValue(true);

  app = Fastify();
  await app.register((instance: FastifyInstance) => scriptRoutes(instance, dataDir));
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(tempDir, { recursive: true, force: true });
});

async function writeHiveJson(value: unknown): Promise<void> {
  await writeFile(join(wsPath, "hive.json"), JSON.stringify(value), "utf-8");
}

describe("script routes", () => {
  it("GET /api/workspaces/:wsId/scripts returns hive config and status", async () => {
    await writeHiveJson({
      scripts: {
        setup: "npm ci",
        run: "npm run dev",
      },
      port: 4173,
    });
    mocks.getScriptStatus.mockReturnValue({
      setup: { state: "done", exitCode: 0 },
      run: { state: "running" },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${WS_ID}/scripts`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      config: {
        scripts: {
          setup: "npm ci",
          run: "npm run dev",
        },
        port: 4173,
      },
      status: {
        setup: { state: "done", exitCode: 0 },
        run: { state: "running" },
      },
    });
  });

  it("GET /api/workspaces/:wsId/scripts returns 404 when workspace is missing", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/workspaces/missing/scripts",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Workspace not found" });
  });

  it("POST /api/workspaces/:wsId/scripts/:type/start validates script type", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${WS_ID}/scripts/build/start`,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid script type (setup|run)" });
  });

  it("POST /api/workspaces/:wsId/scripts/:type/start returns 404 for unknown workspace", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/workspaces/missing/scripts/setup/start",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Workspace not found" });
  });

  it("POST /api/workspaces/:wsId/scripts/:type/start returns 400 when script is missing in hive.json", async () => {
    await writeHiveJson({
      scripts: { setup: "npm ci" },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${WS_ID}/scripts/run/start`,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'No "run" script defined in hive.json' });
  });

  it("POST /api/workspaces/:wsId/scripts/:type/start starts the script", async () => {
    await writeHiveJson({
      scripts: { run: "npm run dev" },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${WS_ID}/scripts/run/start`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ started: true });
    expect(mocks.startScript).toHaveBeenCalledWith(WS_ID, "run", "npm run dev", wsPath);
  });

  it("POST /api/workspaces/:wsId/scripts/:type/start maps runner errors to 409", async () => {
    await writeHiveJson({
      scripts: { setup: "npm ci" },
    });
    mocks.startScript.mockImplementation(() => {
      throw new Error('Script "setup" is already running');
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${WS_ID}/scripts/setup/start`,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('Script "setup" is already running');
  });

  it("POST /api/workspaces/:wsId/scripts/:type/stop validates script type", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${WS_ID}/scripts/build/stop`,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid script type (setup|run)" });
  });

  it("POST /api/workspaces/:wsId/scripts/:type/stop returns 409 when no script is running", async () => {
    mocks.stopScript.mockReturnValue(false);

    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${WS_ID}/scripts/run/stop`,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'No running "run" script to stop' });
  });

  it("POST /api/workspaces/:wsId/scripts/:type/stop stops a running script", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${WS_ID}/scripts/setup/stop`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ stopped: true });
    expect(mocks.stopScript).toHaveBeenCalledWith(WS_ID, "setup");
  });
});
