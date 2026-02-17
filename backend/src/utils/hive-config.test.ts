import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readHiveConfig } from "./hive-config.js";

let wsPath: string;

beforeEach(async () => {
  wsPath = await mkdtemp(join(tmpdir(), "hive-config-test-"));
});

afterEach(async () => {
  await rm(wsPath, { recursive: true, force: true });
});

describe("readHiveConfig", () => {
  it("returns null when hive.json does not exist", async () => {
    await expect(readHiveConfig(wsPath)).resolves.toBeNull();
  });

  it("returns null for malformed JSON", async () => {
    await writeFile(join(wsPath, "hive.json"), "{ invalid json", "utf-8");
    await expect(readHiveConfig(wsPath)).resolves.toBeNull();
  });

  it("returns null when root JSON value is not an object", async () => {
    await writeFile(join(wsPath, "hive.json"), JSON.stringify(["not-object"]), "utf-8");
    await expect(readHiveConfig(wsPath)).resolves.toBeNull();
  });

  it("parses valid scripts and port", async () => {
    await writeFile(
      join(wsPath, "hive.json"),
      JSON.stringify({
        scripts: {
          setup: "npm ci",
          run: "npm run dev",
        },
        port: 4173,
      }),
      "utf-8",
    );

    await expect(readHiveConfig(wsPath)).resolves.toEqual({
      scripts: {
        setup: "npm ci",
        run: "npm run dev",
      },
      port: 4173,
    });
  });

  it("drops unknown and invalid script fields but keeps valid ones", async () => {
    await writeFile(
      join(wsPath, "hive.json"),
      JSON.stringify({
        scripts: {
          setup: "npm ci",
          run: 123,
          test: "npm test",
        },
      }),
      "utf-8",
    );

    await expect(readHiveConfig(wsPath)).resolves.toEqual({
      scripts: {
        setup: "npm ci",
      },
    });
  });

  it("drops invalid port values", async () => {
    await writeFile(
      join(wsPath, "hive.json"),
      JSON.stringify({
        scripts: { run: "npm run dev" },
        port: 70_000,
      }),
      "utf-8",
    );

    await expect(readHiveConfig(wsPath)).resolves.toEqual({
      scripts: { run: "npm run dev" },
    });
  });

  it("returns empty config object when file is valid JSON but has no known fields", async () => {
    await writeFile(
      join(wsPath, "hive.json"),
      JSON.stringify({
        name: "workspace",
        scripts: "not-an-object",
        port: 0,
      }),
      "utf-8",
    );

    await expect(readHiveConfig(wsPath)).resolves.toEqual({});
  });
});
