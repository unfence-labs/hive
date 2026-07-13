import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, saveConfig, updateConfig, type AppConfig } from "./config.js";

const DEFAULT_APNS = { enabled: false, teamId: "", keyId: "", keyContent: "", bundleId: "", sandbox: false, deviceTokens: [] as string[] };

const DEFAULT_CONFIG: AppConfig = {
  notifications: {
    telegram: { enabled: false, botToken: "", chatId: "" },
    apns: { ...DEFAULT_APNS },
  },
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
        apns: { ...DEFAULT_APNS },
      },
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
        apns: { enabled: true, teamId: "T", keyId: "K", keyContent: "PEM", bundleId: "com.x", sandbox: true, deviceTokens: ["abc"] },
      },
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
        apns: { ...DEFAULT_APNS },
      },
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

  it("fills missing apns fields with defaults when only some are present", async () => {
    await writeFile(
      join(dataDir, "config.json"),
      JSON.stringify({ notifications: { telegram: { enabled: false, botToken: "", chatId: "" }, apns: { enabled: true, teamId: "T1" } } }),
      "utf-8",
    );

    const config = await loadConfig(dataDir);
    expect(config.notifications.apns).toEqual({
      enabled: true,
      teamId: "T1",
      keyId: "",
      keyContent: "",
      bundleId: "",
      sandbox: false,
      deviceTokens: [],
    });
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
        apns: { enabled: true, teamId: "T", keyId: "K", keyContent: "PEM", bundleId: "com.x", sandbox: false, deviceTokens: ["deadbeef"] },
      },
    };

    await saveConfig(config, dataDir);

    const raw = await readFile(join(dataDir, "config.json"), "utf-8");
    expect(raw).toContain("\n");
    expect(JSON.parse(raw)).toEqual(config);

    const loaded = await loadConfig(dataDir);
    expect(loaded).toEqual(config);
  });
});

describe("updateConfig", () => {
  it("persists concurrent updates without dropping either", async () => {
    await Promise.all([
      updateConfig((c) => { c.defaultModelId = "claude:opus-4-8"; }, dataDir),
      updateConfig((c) => { c.notifications.apns.deviceTokens.push("deadbeef"); }, dataDir),
    ]);

    const loaded = await loadConfig(dataDir);
    expect(loaded.defaultModelId).toBe("claude:opus-4-8");
    expect(loaded.notifications.apns.deviceTokens).toEqual(["deadbeef"]);
  });

  it("keeps accepting updates after a mutate callback throws", async () => {
    await expect(
      updateConfig(() => { throw new Error("boom"); }, dataDir),
    ).rejects.toThrow("boom");

    await updateConfig((c) => { c.defaultModelId = "claude:opus-4-8"; }, dataDir);

    const loaded = await loadConfig(dataDir);
    expect(loaded.defaultModelId).toBe("claude:opus-4-8");
  });
});
