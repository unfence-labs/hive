import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { SETUP_PROTOCOL_VERSION } from "@hive/shared/setup-types";
import { versionRoutes, buildVersionResponse, getBackendVersion } from "./version.js";

let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  app = Fastify();
  await app.register((instance: FastifyInstance) => versionRoutes(instance));
  await app.ready();
});

afterEach(async () => {
  await app.close();
  delete process.env.HIVE_COMMIT;
});

describe("GET /api/version", () => {
  it("returns version and protocolVersion", async () => {
    const res = await app.inject({ method: "GET", url: "/api/version" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.version).toBe(getBackendVersion());
    expect(body.protocolVersion).toBe(SETUP_PROTOCOL_VERSION);
    expect(body.commit).toBeUndefined();
  });
});

describe("buildVersionResponse", () => {
  it("omits commit when HIVE_COMMIT is unset", () => {
    delete process.env.HIVE_COMMIT;
    const payload = buildVersionResponse();
    expect(payload).not.toHaveProperty("commit");
  });

  it("includes commit from HIVE_COMMIT when present", () => {
    process.env.HIVE_COMMIT = "abc123";
    expect(buildVersionResponse().commit).toBe("abc123");
  });

  it("reads a non-empty backend version", () => {
    expect(getBackendVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
