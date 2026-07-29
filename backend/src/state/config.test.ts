import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, saveConfig, updateConfig, type AppConfig } from "./config.js";

const DEFAULT_CONFIG: AppConfig = {
  notifications: {
    telegram: { enabled: false, botToken: "", chatId: "" },
  },
  kimi: { apiKey: "" },
};

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "hive-config-test-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns defaults when config file is missing", async () => {
    const config = await loadConfig(dataDir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("returns defaults when config file is invalid JSON", async () => {
    await writeFile(join(dataDir, "config.json"), "{invalid", "utf-8");

    const config = await loadConfig(dataDir);

    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("fills missing nested values with defaults", async () => {
    await writeFile(
      join(dataDir, "config.json"),
      JSON.stringify({ notifications: { telegram: { enabled: true } } }),
      "utf-8",
    );

    const config = await loadConfig(dataDir);

    expect(config).toEqual({
      notifications: {
        telegram: { enabled: true, botToken: "", chatId: "" },
      },
      kimi: { apiKey: "" },
    });
  });

  it("returns a fresh default object each time", async () => {
    const first = await loadConfig(dataDir);
    first.notifications.telegram.enabled = true;

    const second = await loadConfig(dataDir);

    expect(second.notifications.telegram.enabled).toBe(false);
  });

  it("loads a fully populated config file", async () => {
    const full: AppConfig = {
      notifications: {
        telegram: { enabled: true, botToken: "tok", chatId: "cid" },
      },
      kimi: { apiKey: "kimi-key" },
    };
    await writeFile(join(dataDir, "config.json"), JSON.stringify(full), "utf-8");

    const config = await loadConfig(dataDir);
    expect(config).toEqual(full);
  });

  it("ignores unknown top-level keys in the config file", async () => {
    await writeFile(
      join(dataDir, "config.json"),
      JSON.stringify({
        notifications: { telegram: { enabled: true, botToken: "t", chatId: "c" } },
        unknownKey: "should-be-ignored",
      }),
      "utf-8",
    );

    const config = await loadConfig(dataDir);
    expect(config).toEqual({
      notifications: {
        telegram: { enabled: true, botToken: "t", chatId: "c" },
      },
      kimi: { apiKey: "" },
    });
    expect((config as unknown as Record<string, unknown>)["unknownKey"]).toBeUndefined();
  });

  it("handles completely empty notifications object", async () => {
    await writeFile(
      join(dataDir, "config.json"),
      JSON.stringify({ notifications: {} }),
      "utf-8",
    );

    const config = await loadConfig(dataDir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("defaults kimi when the config file predates the field", async () => {
    await writeFile(
      join(dataDir, "config.json"),
      JSON.stringify({ notifications: { telegram: { enabled: true, botToken: "t", chatId: "c" } } }),
      "utf-8",
    );

    const config = await loadConfig(dataDir);
    expect(config.kimi).toEqual({ apiKey: "" });
  });

  it("loads a saved kimi api key", async () => {
    await writeFile(
      join(dataDir, "config.json"),
      JSON.stringify({ kimi: { apiKey: "sk-kimi" } }),
      "utf-8",
    );

    const config = await loadConfig(dataDir);
    expect(config.kimi.apiKey).toBe("sk-kimi");
  });

});

describe("saveConfig", () => {
  it("creates dataDir recursively if it does not exist", async () => {
    const nestedDir = join(dataDir, "nested", "deep");

    await saveConfig(DEFAULT_CONFIG, nestedDir);

    const loaded = await loadConfig(nestedDir);
    expect(loaded).toEqual(DEFAULT_CONFIG);
  });

  it("writes pretty JSON and round-trips through loadConfig", async () => {
    const config: AppConfig = {
      notifications: {
        telegram: { enabled: true, botToken: "bot-token", chatId: "chat-id" },
      },
      kimi: { apiKey: "kimi-key" },
    };

    await saveConfig(config, dataDir);

    const raw = await readFile(join(dataDir, "config.json"), "utf-8");
    expect(raw).toContain("\n");
    expect(JSON.parse(raw)).toEqual(config);

    const loaded = await loadConfig(dataDir);
    expect(loaded).toEqual(config);
  });

  // File modes are meaningless on Windows.
  it.skipIf(process.platform === "win32")(
    "writes config.json with owner-only permissions (it holds credentials)",
    async () => {
      await saveConfig({ ...DEFAULT_CONFIG, kimi: { apiKey: "sk-secret" } }, dataDir);

      const { mode } = await stat(join(dataDir, "config.json"));
      expect(mode & 0o777).toBe(0o600);
    },
  );
});

describe("updateConfig", () => {
  it("persists concurrent updates without dropping either", async () => {
    await Promise.all([
      updateConfig((c) => { c.defaultModelId = "claude:opus-4-8"; }, dataDir),
      updateConfig((c) => { c.kimi.apiKey = "sk-kimi"; }, dataDir),
    ]);

    const loaded = await loadConfig(dataDir);
    expect(loaded.defaultModelId).toBe("claude:opus-4-8");
    expect(loaded.kimi.apiKey).toBe("sk-kimi");
  });

  it("keeps accepting updates after a mutate callback throws", async () => {
    await expect(
      updateConfig(() => { throw new Error("boom"); }, dataDir),
    ).rejects.toThrow("boom");

    await updateConfig((c) => { c.defaultModelId = "claude:opus-4-8"; }, dataDir);

    const loaded = await loadConfig(dataDir);
    expect(loaded.defaultModelId).toBe("claude:opus-4-8");
  });

  it("rejects and leaves the file untouched when config.json is corrupt", async () => {
    await writeFile(join(dataDir, "config.json"), "{invalid", "utf-8");

    await expect(
      updateConfig((c) => { c.defaultModelId = "claude:opus-4-8"; }, dataDir),
    ).rejects.toThrow();

    const raw = await readFile(join(dataDir, "config.json"), "utf-8");
    expect(raw).toBe("{invalid");
  });

  it("rejects when config.json is not a JSON object", async () => {
    await writeFile(join(dataDir, "config.json"), "null", "utf-8");

    await expect(
      updateConfig((c) => { c.defaultModelId = "claude:opus-4-8"; }, dataDir),
    ).rejects.toThrow("does not contain a JSON object");

    const raw = await readFile(join(dataDir, "config.json"), "utf-8");
    expect(raw).toBe("null");
  });

  it("rejects and leaves the file untouched when config.json has an array root", async () => {
    await writeFile(join(dataDir, "config.json"), "[]", "utf-8");

    await expect(
      updateConfig((c) => { c.defaultModelId = "claude:opus-4-8"; }, dataDir),
    ).rejects.toThrow("does not contain a JSON object");

    const raw = await readFile(join(dataDir, "config.json"), "utf-8");
    expect(raw).toBe("[]");
  });

  it("creates the file when it does not exist yet", async () => {
    await updateConfig((c) => { c.defaultModelId = "claude:opus-4-8"; }, dataDir);

    const loaded = await loadConfig(dataDir);
    expect(loaded.defaultModelId).toBe("claude:opus-4-8");
  });
});
