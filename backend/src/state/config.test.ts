import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, saveConfig, type AppConfig } from "./config.js";

const DEFAULT_CONFIG: AppConfig = {
  notifications: {
    telegram: { enabled: false, botToken: "", chatId: "" },
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
        telegram: {
          enabled: true,
          botToken: "",
          chatId: "",
        },
      },
    });
  });

  it("returns a fresh default object each time", async () => {
    const first = await loadConfig(dataDir);
    first.notifications.telegram.enabled = true;

    const second = await loadConfig(dataDir);

    expect(second.notifications.telegram.enabled).toBe(false);
  });
});

describe("saveConfig", () => {
  it("writes pretty JSON and round-trips through loadConfig", async () => {
    const config: AppConfig = {
      notifications: {
        telegram: {
          enabled: true,
          botToken: "bot-token",
          chatId: "chat-id",
        },
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
