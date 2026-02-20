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

  it("parses valid scripts (object run) and port", async () => {
    await writeFile(
      join(wsPath, "hive.json"),
      JSON.stringify({
        scripts: {
          setup: "npm ci",
          run: { backend: "npm run dev", frontend: "npm start" },
        },
        port: 4173,
      }),
      "utf-8",
    );

    await expect(readHiveConfig(wsPath)).resolves.toEqual({
      scripts: {
        setup: "npm ci",
        run: { backend: "npm run dev", frontend: "npm start" },
      },
      port: 4173,
    });
  });

  it("normalizes string run to { run: cmd }", async () => {
    await writeFile(
      join(wsPath, "hive.json"),
      JSON.stringify({
        scripts: { setup: "npm ci", run: "npm run dev" },
      }),
      "utf-8",
    );

    await expect(readHiveConfig(wsPath)).resolves.toEqual({
      scripts: { setup: "npm ci", run: { run: "npm run dev" } },
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

  it("keeps only valid string entries inside run object", async () => {
    await writeFile(
      join(wsPath, "hive.json"),
      JSON.stringify({
        scripts: {
          run: {
            backend: "npm run dev:backend",
            retries: 3,
            nested: { cmd: "npm run dev" },
          },
        },
      }),
      "utf-8",
    );

    await expect(readHiveConfig(wsPath)).resolves.toEqual({
      scripts: {
        run: {
          backend: "npm run dev:backend",
        },
      },
    });
  });

  it("drops invalid port values", async () => {
    await writeFile(
      join(wsPath, "hive.json"),
      JSON.stringify({
        scripts: { run: { dev: "npm run dev" } },
        port: 70_000,
      }),
      "utf-8",
    );

    await expect(readHiveConfig(wsPath)).resolves.toEqual({
      scripts: { run: { dev: "npm run dev" } },
    });
  });

  it("accepts port=1 (minimum valid)", async () => {
    await writeFile(join(wsPath, "hive.json"), JSON.stringify({ port: 1 }), "utf-8");
    const config = await readHiveConfig(wsPath);
    expect(config?.port).toBe(1);
  });

  it("accepts port=65535 (maximum valid)", async () => {
    await writeFile(join(wsPath, "hive.json"), JSON.stringify({ port: 65535 }), "utf-8");
    const config = await readHiveConfig(wsPath);
    expect(config?.port).toBe(65535);
  });

  it("rejects port=0", async () => {
    await writeFile(join(wsPath, "hive.json"), JSON.stringify({ port: 0 }), "utf-8");
    const config = await readHiveConfig(wsPath);
    expect(config?.port).toBeUndefined();
  });

  it("rejects port=65536", async () => {
    await writeFile(join(wsPath, "hive.json"), JSON.stringify({ port: 65536 }), "utf-8");
    const config = await readHiveConfig(wsPath);
    expect(config?.port).toBeUndefined();
  });

  it("rejects float port", async () => {
    await writeFile(join(wsPath, "hive.json"), JSON.stringify({ port: 3000.5 }), "utf-8");
    const config = await readHiveConfig(wsPath);
    expect(config?.port).toBeUndefined();
  });

  it("rejects string port", async () => {
    await writeFile(join(wsPath, "hive.json"), JSON.stringify({ port: "3000" }), "utf-8");
    const config = await readHiveConfig(wsPath);
    expect(config?.port).toBeUndefined();
  });

  it("rejects negative port", async () => {
    await writeFile(join(wsPath, "hive.json"), JSON.stringify({ port: -1 }), "utf-8");
    const config = await readHiveConfig(wsPath);
    expect(config?.port).toBeUndefined();
  });

  it("parses only run script (setup absent)", async () => {
    await writeFile(
      join(wsPath, "hive.json"),
      JSON.stringify({ scripts: { run: { dev: "npm run dev" } } }),
      "utf-8",
    );
    const config = await readHiveConfig(wsPath);
    expect(config).toEqual({ scripts: { run: { dev: "npm run dev" } } });
  });

  it("returns null for root value null", async () => {
    await writeFile(join(wsPath, "hive.json"), "null", "utf-8");
    await expect(readHiveConfig(wsPath)).resolves.toBeNull();
  });

  it("omits scripts key entirely when scripts object has no valid entries", async () => {
    await writeFile(
      join(wsPath, "hive.json"),
      JSON.stringify({ scripts: { setup: 123, run: false } }),
      "utf-8",
    );
    const config = await readHiveConfig(wsPath);
    expect(config).toEqual({});
    expect(config?.scripts).toBeUndefined();
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
