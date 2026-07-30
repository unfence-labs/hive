// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("Tauri updater configuration", () => {
  let config: {
    bundle: { createUpdaterArtifacts?: boolean };
    plugins: { updater?: { endpoints?: string[]; pubkey?: string } };
  };

  // Load the Tauri config file once
  async function loadConfig() {
    if (config) return;
    const configRaw = await readFile(join(process.cwd(), "src-tauri", "tauri.conf.json"), "utf-8");
    config = JSON.parse(configRaw);
  }

  it("emits updater artifacts when bundling", async () => {
    await loadConfig();

    expect(config.bundle.createUpdaterArtifacts).toBe(true);
  });

  it("points at the latest stable release manifest", async () => {
    await loadConfig();

    expect(config.plugins.updater?.endpoints).toEqual([
      "https://github.com/unfence-labs/hive/releases/latest/download/latest.json",
    ]);
  });

  it("carries the public key that verifies release signatures", async () => {
    await loadConfig();

    expect(typeof config.plugins.updater?.pubkey).toBe("string");
    expect(config.plugins.updater?.pubkey).not.toBe("");
  });
});
