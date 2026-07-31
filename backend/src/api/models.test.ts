import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { modelRoutes } from "./models.js";
import { getModelCatalog, markProviderAvailable } from "../agents/providers/registry.js";
import { loadConfig, saveConfig } from "../state/config.js";
import type { SetupToolId } from "@hive/shared/setup-types";
import type { DetectDeps } from "../services/setup/detect.js";

let tempDir: string;
let app: ReturnType<typeof Fastify>;
let authenticated: Partial<Record<SetupToolId, boolean>>;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "hive-models-api-test-"));
  markProviderAvailable("claude");
  markProviderAvailable("codex");
  authenticated = { claude: true, codex: false };
  const detect: DetectDeps = {
    run: vi.fn(async (command) => {
      const signedIn = authenticated[command as SetupToolId] === true;
      if (command === "claude") {
        return {
          stdout: JSON.stringify({ loggedIn: signedIn }),
          stderr: "",
          exitCode: 0,
          timedOut: false,
        };
      }
      return {
        stdout: signedIn ? "Logged in using ChatGPT" : "Not logged in",
        stderr: "",
        exitCode: 0,
        timedOut: false,
      };
    }),
  };

  app = Fastify();
  await app.register((instance: FastifyInstance) =>
    modelRoutes(instance, { dataDir: tempDir, detect }),
  );
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("GET /api/models", () => {
  it("returns the registry default when no user default is saved", async () => {
    const res = await app.inject({ method: "GET", url: "/api/models" });

    expect(res.statusCode).toBe(200);
    expect(res.json().defaultModelId).toBe(
      getModelCatalog({ excludedProviderIds: new Set(["codex"]) }).defaultModelId,
    );
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
    expect(res.json().defaultModelId).toMatch(/^claude:/);
  });

  it("ignores a saved default whose harness is not authenticated", async () => {
    const codexDefault = getModelCatalog().models.find(
      (model) => model.provider === "codex" && model.isDefault,
    )!;
    const config = await loadConfig(tempDir);
    await saveConfig({ ...config, defaultModelId: codexDefault.id }, tempDir);

    const res = await app.inject({ method: "GET", url: "/api/models" });

    expect(res.statusCode).toBe(200);
    expect(res.json().defaultModelId).toMatch(/^claude:/);
  });

  it.each([
    {
      name: "Claude only",
      authentication: { claude: true, codex: false },
      providers: ["claude"],
    },
    {
      name: "Codex only",
      authentication: { claude: false, codex: true },
      providers: ["codex"],
    },
    {
      name: "both harnesses",
      authentication: { claude: true, codex: true },
      providers: ["claude", "codex"],
    },
    {
      name: "no harness",
      authentication: { claude: false, codex: false },
      providers: [],
    },
  ])("returns models for $name", async ({ authentication, providers }) => {
    authenticated = authentication;

    const res = await app.inject({ method: "GET", url: "/api/models" });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect([...new Set(body.models.map((model: { provider: string }) => model.provider))])
      .toEqual(providers);
    if (providers.length === 0) {
      expect(body.defaultModelId).toBe("");
    } else {
      expect(body.defaultModelId).toEqual(expect.any(String));
    }
  });

  it("re-probes authentication on every request", async () => {
    authenticated = { claude: true, codex: false };
    const first = await app.inject({ method: "GET", url: "/api/models" });

    authenticated = { claude: false, codex: true };
    const second = await app.inject({ method: "GET", url: "/api/models" });

    expect(new Set(first.json().models.map((model: { provider: string }) => model.provider)))
      .toEqual(new Set(["claude"]));
    expect(new Set(second.json().models.map((model: { provider: string }) => model.provider)))
      .toEqual(new Set(["codex"]));
  });

  it("keeps Kimi available with its key when Claude is not authenticated", async () => {
    authenticated = { claude: false, codex: false };
    markProviderAvailable("kimi");
    const config = await loadConfig(tempDir);
    await saveConfig({ ...config, kimi: { apiKey: "sk-kimi" } }, tempDir);

    const res = await app.inject({ method: "GET", url: "/api/models" });
    const providers = new Set(
      res.json().models.map((model: { provider: string }) => model.provider),
    );

    expect(res.statusCode).toBe(200);
    expect(providers).toEqual(new Set(["kimi"]));
    expect(res.json().defaultModelId).toMatch(/^kimi:/);
  });
});
