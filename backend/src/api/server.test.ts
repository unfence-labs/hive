import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { serverRoutes, readBackendVersion, readUpdateMethod } from "./server.js";

let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  app = Fastify();
  await app.register((instance: FastifyInstance) => serverRoutes(instance));
  await app.ready();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await app.close();
});

describe("GET /api/server/version", () => {
  it("reports the configured version and update method", async () => {
    vi.stubEnv("HIVE_BACKEND_VERSION", "0.1.0");
    vi.stubEnv("HIVE_UPDATE_METHOD", "provisioner");

    const res = await app.inject({ method: "GET", url: "/api/server/version" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ version: "0.1.0", updateMethod: "provisioner" });
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

  it("prefers the configured version over the VERSION file", async () => {
    const file = join(tempDir, "VERSION");
    await writeFile(file, "0.1.0\n");

    expect(await readBackendVersion(pathToFileURL(file), " 0.2.0-beta.1 ")).toBe(
      "0.2.0-beta.1",
    );
  });

  it("falls back to dev when the file is missing or empty", async () => {
    expect(await readBackendVersion(pathToFileURL(join(tempDir, "VERSION")))).toBe("dev");

    const empty = join(tempDir, "VERSION");
    await writeFile(empty, "\n");
    expect(await readBackendVersion(pathToFileURL(empty))).toBe("dev");
  });
});

describe("readUpdateMethod", () => {
  it("opts in only for the provisioner", () => {
    expect(readUpdateMethod("provisioner")).toBe("provisioner");
  });

  it("defaults missing and invalid methods to manual", () => {
    expect(readUpdateMethod(undefined)).toBe("manual");
    expect(readUpdateMethod("manual")).toBe("manual");
    expect(readUpdateMethod("automatic")).toBe("manual");
  });
});
