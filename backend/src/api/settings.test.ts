import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mocks = vi.hoisted(() => ({
  rebuildNotifier: vi.fn(),
  updateLiveApnsToken: vi.fn(),
}));

vi.mock("../agents/agent-manager.js", () => ({
  rebuildNotifier: mocks.rebuildNotifier,
  updateLiveApnsToken: mocks.updateLiveApnsToken,
}));

import { settingsRoutes } from "./settings.js";
import { loadConfig } from "../state/config.js";
import { TelegramChannel } from "../notifications/telegram.js";
import { getModelCatalog, markProviderAvailable } from "../agents/providers/registry.js";

const DEFAULT_APNS = { enabled: false, teamId: "", keyId: "", keyContent: "", bundleId: "", sandbox: false, deviceTokens: [] as string[] };

let tempDir: string;
let app: ReturnType<typeof Fastify>;
let previousDataDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "hive-settings-api-test-"));
  previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;

  app = Fastify();
  await app.register((instance: FastifyInstance) => settingsRoutes(instance));
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.clearAllMocks();

  if (previousDataDir === undefined) {
    delete process.env.DATA_DIR;
  } else {
    process.env.DATA_DIR = previousDataDir;
  }
});

describe("defaults routes", () => {
  it("GET /api/settings/defaults returns null when nothing is saved", async () => {
    const res = await app.inject({ method: "GET", url: "/api/settings/defaults" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ defaultModelId: null });
  });

  it("PUT /api/settings/defaults rejects non-string payloads", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/defaults",
      payload: { defaultModelId: 42 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid payload" });
  });

  it("PUT /api/settings/defaults rejects model ids not in the catalog", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/defaults",
      payload: { defaultModelId: "claude:not-a-model" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Unknown model id" });
  });

  it("PUT /api/settings/defaults saves a catalog model and GET returns it", async () => {
    markProviderAvailable("claude");
    const modelId = getModelCatalog().models[0].id;

    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/defaults",
      payload: { defaultModelId: modelId },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ defaultModelId: modelId });

    const config = await loadConfig(tempDir);
    expect(config.defaultModelId).toBe(modelId);

    const getRes = await app.inject({ method: "GET", url: "/api/settings/defaults" });
    expect(getRes.json()).toEqual({ defaultModelId: modelId });
  });

  it("PUT /api/settings/defaults with null clears the saved default", async () => {
    markProviderAvailable("claude");
    const modelId = getModelCatalog().models[0].id;
    await app.inject({
      method: "PUT",
      url: "/api/settings/defaults",
      payload: { defaultModelId: modelId },
    });

    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/defaults",
      payload: { defaultModelId: null },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ defaultModelId: null });

    const config = await loadConfig(tempDir);
    expect(config.defaultModelId).toBeUndefined();
  });
});

describe("kimi routes", () => {
  it("GET /api/settings/kimi returns an empty key by default", async () => {
    const res = await app.inject({ method: "GET", url: "/api/settings/kimi" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ apiKey: "" });
  });

  it("PUT /api/settings/kimi rejects non-string payloads", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/kimi",
      payload: { apiKey: 42 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid payload" });
  });

  it("PUT /api/settings/kimi saves the trimmed key and GET returns it", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/kimi",
      payload: { apiKey: "  sk-kimi-key  " },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ apiKey: "sk-kimi-key" });

    const config = await loadConfig(tempDir);
    expect(config.kimi.apiKey).toBe("sk-kimi-key");

    const getRes = await app.inject({ method: "GET", url: "/api/settings/kimi" });
    expect(getRes.json()).toEqual({ apiKey: "sk-kimi-key" });
  });

  it("PUT /api/settings/kimi with an empty string clears the saved key", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/settings/kimi",
      payload: { apiKey: "sk-kimi-key" },
    });

    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/kimi",
      payload: { apiKey: "" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ apiKey: "" });

    const config = await loadConfig(tempDir);
    expect(config.kimi.apiKey).toBe("");
  });
});

describe("settings routes", () => {
  it("GET /api/settings/notifications returns default config", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/settings/notifications",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      telegram: { enabled: false, botToken: "", chatId: "" },
      apns: { ...DEFAULT_APNS },
    });
  });

  it("PUT /api/settings/notifications validates payload", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/notifications",
      payload: { telegram: { enabled: "yes" } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid payload" });
  });

  it("PUT /api/settings/notifications saves trimmed values and rebuilds notifier", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/notifications",
      payload: {
        telegram: {
          enabled: true,
          botToken: "  bot-token  ",
          chatId: "  chat-id  ",
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const config = await loadConfig(tempDir);
    expect(config).toEqual({
      notifications: {
        telegram: { enabled: true, botToken: "bot-token", chatId: "chat-id" },
        apns: { ...DEFAULT_APNS },
      },
      kimi: { apiKey: "" },
    });

    expect(mocks.rebuildNotifier).toHaveBeenCalledTimes(1);
    expect(mocks.rebuildNotifier).toHaveBeenCalledWith(config);
  });

  it("PUT /api/settings/notifications returns 400 when neither telegram nor apns field is present", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/notifications",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid payload" });
  });

  it("PUT /api/settings/notifications defaults missing botToken and chatId to empty string", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/notifications",
      payload: { telegram: { enabled: false } },
    });

    expect(res.statusCode).toBe(200);

    const config = await loadConfig(tempDir);
    expect(config.notifications.telegram.botToken).toBe("");
    expect(config.notifications.telegram.chatId).toBe("");
  });

  it("GET /api/settings/notifications returns saved config after PUT", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/settings/notifications",
      payload: {
        telegram: { enabled: true, botToken: "saved-token", chatId: "saved-chat" },
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/settings/notifications",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      telegram: { enabled: true, botToken: "saved-token", chatId: "saved-chat" },
      apns: { ...DEFAULT_APNS },
    });
  });

  it("PUT /api/settings/notifications with apns preserves existing device tokens", async () => {
    // Pre-seed config with a registered device token
    const { saveConfig } = await import("../state/config.js");
    await saveConfig({
      notifications: {
        telegram: { enabled: false, botToken: "", chatId: "" },
        apns: { ...DEFAULT_APNS, deviceTokens: ["deadbeef"] },
      },
      kimi: { apiKey: "" },
    }, tempDir);

    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/notifications",
      payload: {
        apns: { enabled: true, teamId: "T", keyId: "K", keyContent: "PEM", bundleId: "com.x", sandbox: false },
      },
    });

    expect(res.statusCode).toBe(200);

    const config = await loadConfig(tempDir);
    expect(config.notifications.apns.enabled).toBe(true);
    expect(config.notifications.apns.deviceTokens).toEqual(["deadbeef"]);
  });

  it("POST /api/devices/apns registers a new device token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/devices/apns",
      payload: { token: "AABBCCDD11223344AABBCCDD11223344" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, added: true });

    const config = await loadConfig(tempDir);
    expect(config.notifications.apns.deviceTokens).toContain("aabbccdd11223344aabbccdd11223344");
  });

  it("POST /api/devices/apns deduplicates existing tokens", async () => {
    const { saveConfig } = await import("../state/config.js");
    await saveConfig({
      notifications: {
        telegram: { enabled: false, botToken: "", chatId: "" },
        apns: { ...DEFAULT_APNS, deviceTokens: ["aabbccdd11223344aabbccdd11223344"] },
      },
      kimi: { apiKey: "" },
    }, tempDir);

    const res = await app.inject({
      method: "POST",
      url: "/api/devices/apns",
      payload: { token: "AABBCCDD11223344AABBCCDD11223344" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, added: false });
  });

  it("POST /api/devices/apns rejects invalid tokens", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/devices/apns",
      payload: { token: "short" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("POST /api/settings/notifications/test returns 400 when chatId is empty", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/settings/notifications/test",
      payload: { botToken: "valid-token", chatId: "" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("POST /api/settings/notifications/test returns 400 when chatId is whitespace", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/settings/notifications/test",
      payload: { botToken: "valid-token", chatId: "   " },
    });

    expect(res.statusCode).toBe(400);
  });

  it("POST /api/settings/notifications/test proxies successful result", async () => {
    vi.spyOn(TelegramChannel, "sendTest").mockResolvedValue({ ok: true });

    const res = await app.inject({
      method: "POST",
      url: "/api/settings/notifications/test",
      payload: { botToken: "token", chatId: "chat" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("POST /api/settings/notifications/test validates required fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/settings/notifications/test",
      payload: { botToken: "", chatId: "chat-id" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: "Bot token and chat ID are required" });
  });

  it("POST /api/settings/notifications/test proxies Telegram test result", async () => {
    const sendTestSpy = vi
      .spyOn(TelegramChannel, "sendTest")
      .mockResolvedValue({ ok: false, error: "chat not found" });

    const res = await app.inject({
      method: "POST",
      url: "/api/settings/notifications/test",
      payload: { botToken: " token ", chatId: " chat " },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: false, error: "chat not found" });
    expect(sendTestSpy).toHaveBeenCalledWith(" token ", " chat ");
  });
});
