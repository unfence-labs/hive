import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mocks = vi.hoisted(() => ({
  getDetectedPreviewUrl: vi.fn(),
  getPreviewProxy: vi.fn(),
  startPreviewProxy: vi.fn(),
  stopPreviewProxy: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

vi.mock("../services/preview-proxy.js", () => ({
  getDetectedPreviewUrl: mocks.getDetectedPreviewUrl,
  getPreviewProxy: mocks.getPreviewProxy,
  startPreviewProxy: mocks.startPreviewProxy,
  stopPreviewProxy: mocks.stopPreviewProxy,
}));

vi.mock("../ws/stream.js", () => ({
  broadcastToWorkspace: mocks.broadcastToWorkspace,
}));

import { previewRoutes } from "./preview.js";
import { saveProject } from "../state/state.js";
import type { ProjectState } from "../types.js";

let tempDir: string;
let dataDir: string;
let app: ReturnType<typeof Fastify>;

const PROJECT_ID = "proj-1";
const WS_ID = "ws-1";
const WS_NAME = "tokyo";

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "hive-api-preview-test-"));
  dataDir = join(tempDir, "data");
  const wsPath = join(dataDir, PROJECT_ID, "workspaces", WS_NAME);

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

  mocks.getDetectedPreviewUrl.mockReset();
  mocks.getPreviewProxy.mockReset();
  mocks.startPreviewProxy.mockReset();
  mocks.stopPreviewProxy.mockReset();
  mocks.broadcastToWorkspace.mockReset();
  mocks.getDetectedPreviewUrl.mockReturnValue(undefined);
  mocks.getPreviewProxy.mockReturnValue(null);
  mocks.startPreviewProxy.mockResolvedValue(undefined);

  app = Fastify();
  await app.register((instance: FastifyInstance) => previewRoutes(instance, dataDir));
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("preview routes", () => {
  it("GET /api/workspaces/:wsId/preview returns 404 for unknown workspace", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/workspaces/unknown/preview",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Workspace not found" });
  });

  it("GET /api/workspaces/:wsId/preview returns detected URL and proxy state", async () => {
    mocks.getDetectedPreviewUrl.mockReturnValue("http://localhost:5173");
    mocks.getPreviewProxy.mockReturnValue({ port: 4100, targetUrl: "http://localhost:5173" });

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${WS_ID}/preview`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      detectedUrl: "http://localhost:5173",
      proxy: { port: 4100, targetUrl: "http://localhost:5173" },
    });
  });

  it("POST /api/workspaces/:wsId/preview/start starts the proxy with the provided URL and broadcasts status", async () => {
    mocks.getPreviewProxy.mockReturnValue({ port: 4100, targetUrl: "http://localhost:5173" });

    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${WS_ID}/preview/start`,
      payload: { url: "http://localhost:5173" },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.startPreviewProxy).toHaveBeenCalledWith(WS_ID, "http://localhost:5173");
    expect(mocks.broadcastToWorkspace).toHaveBeenCalledWith(WS_ID, {
      type: "preview_status",
      status: { detectedUrl: undefined, proxy: { port: 4100, targetUrl: "http://localhost:5173" } },
    });
  });

  it("POST /api/workspaces/:wsId/preview/start returns 400 when no URL is provided or detected", async () => {
    mocks.getDetectedPreviewUrl.mockReturnValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${WS_ID}/preview/start`,
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: "No dev server URL. Start a run script or provide a URL.",
    });
    expect(mocks.startPreviewProxy).not.toHaveBeenCalled();
  });

  it("POST /api/workspaces/:wsId/preview/start falls back to the detected URL when body has none", async () => {
    mocks.getDetectedPreviewUrl.mockReturnValue("http://localhost:3000");

    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${WS_ID}/preview/start`,
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.startPreviewProxy).toHaveBeenCalledWith(WS_ID, "http://localhost:3000");
  });

  it("POST /api/workspaces/:wsId/preview/start returns 400 with the error message when startPreviewProxy rejects", async () => {
    mocks.startPreviewProxy.mockRejectedValue(
      new Error("Unsupported preview URL protocol: file:"),
    );

    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${WS_ID}/preview/start`,
      payload: { url: "file:///etc/passwd" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Unsupported preview URL protocol: file:" });
    expect(mocks.broadcastToWorkspace).not.toHaveBeenCalled();
  });

  it("POST /api/workspaces/:wsId/preview/stop returns 404 for unknown workspace", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/workspaces/unknown/preview/stop",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Workspace not found" });
    expect(mocks.stopPreviewProxy).not.toHaveBeenCalled();
  });

  it("POST /api/workspaces/:wsId/preview/stop stops the proxy and broadcasts status", async () => {
    mocks.getPreviewProxy.mockReturnValue(null);

    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${WS_ID}/preview/stop`,
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.stopPreviewProxy).toHaveBeenCalledWith(WS_ID);
    expect(mocks.broadcastToWorkspace).toHaveBeenCalledWith(WS_ID, {
      type: "preview_status",
      status: { detectedUrl: undefined, proxy: null },
    });
  });
});
