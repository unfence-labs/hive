import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { modelRoutes } from "./models.js";
import { getModelCatalog, markProviderAvailable } from "../agents/providers/registry.js";
import { loadConfig, saveConfig } from "../state/config.js";

let tempDir: string;
let app: ReturnType<typeof Fastify>;
let previousDataDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "hive-models-api-test-"));
  previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;
  markProviderAvailable("claude");

  app = Fastify();
  await app.register((instance: FastifyInstance) => modelRoutes(instance));
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(tempDir, { recursive: true, force: true });

  if (previousDataDir === undefined) {
    delete process.env.DATA_DIR;
  } else {
    process.env.DATA_DIR = previousDataDir;
  }
});

describe("GET /api/models", () => {
  it("returns the registry default when no user default is saved", async () => {
    const res = await app.inject({ method: "GET", url: "/api/models" });

    expect(res.statusCode).toBe(200);
    expect(res.json().defaultModelId).toBe(getModelCatalog().defaultModelId);
  });

  it("returns the saved default when it is in the catalog", async () => {
    const catalog = getModelCatalog();
    const nonDefault = catalog.models.find((m) => m.id !== catalog.defaultModelId)!;
    const config = await loadConfig(tempDir);
    await saveConfig({ ...config, defaultModelId: nonDefault.id }, tempDir);

    const res = await app.inject({ method: "GET", url: "/api/models" });

    expect(res.statusCode).toBe(200);
    expect(res.json().defaultModelId).toBe(nonDefault.id);
  });

  it("falls back to the registry default when the saved model is not available", async () => {
    const config = await loadConfig(tempDir);
    await saveConfig({ ...config, defaultModelId: "codex:gone-model" }, tempDir);

    const res = await app.inject({ method: "GET", url: "/api/models" });

    expect(res.statusCode).toBe(200);
    expect(res.json().defaultModelId).toBe(getModelCatalog().defaultModelId);
  });
});
