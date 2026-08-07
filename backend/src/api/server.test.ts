import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { serverRoutes, readBackendVersion } from "./server.js";

let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  app = Fastify();
  await app.register((instance: FastifyInstance) => serverRoutes(instance));
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("GET /api/server/version", () => {
  it("reports dev when running from a source checkout", async () => {
    const res = await app.inject({ method: "GET", url: "/api/server/version" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ version: "dev" });
  });
});

describe("readBackendVersion", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hive-server-version-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns the trimmed VERSION file contents", async () => {
    const file = join(tempDir, "VERSION");
    await writeFile(file, "0.1.0-beta.6\n");

    expect(await readBackendVersion(pathToFileURL(file))).toBe("0.1.0-beta.6");
  });

  it("falls back to dev when the file is missing or empty", async () => {
    expect(await readBackendVersion(pathToFileURL(join(tempDir, "VERSION")))).toBe("dev");

    const empty = join(tempDir, "VERSION");
    await writeFile(empty, "\n");
    expect(await readBackendVersion(pathToFileURL(empty))).toBe("dev");
  });
});
