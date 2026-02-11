import { describe, it, expect, afterEach, vi } from "vitest";

// Prevent the top-level main() from actually listening on a port
vi.mock("fastify", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fastify")>();
  const originalDefault = actual.default;
  return {
    ...actual,
    default: () => {
      const instance = originalDefault();
      const originalListen = instance.listen.bind(instance);
      instance.listen = (async (...listenArgs: unknown[]) => {
        // Only block the main() auto-listen (which uses port 3000)
        const opts = listenArgs[0] as { port?: number } | undefined;
        if (opts?.port === 3000) {
          return "mocked";
        }
        return originalListen(opts as Parameters<typeof originalListen>[0]);
      }) as typeof instance.listen;
      return instance;
    },
  };
});

import { buildApp } from "./index.js";

let app: Awaited<ReturnType<typeof buildApp>>;

afterEach(async () => {
  delete process.env.HIVE_AUTH_TOKEN;
  await app?.close();
});

describe("buildApp", () => {
  it("returns a Fastify instance", async () => {
    app = await buildApp();
    expect(app).toBeDefined();
    expect(typeof app.listen).toBe("function");
  });

  it("registers /health endpoint", async () => {
    app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("registers project routes", async () => {
    app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/projects" });
    expect(res.statusCode).not.toBe(404);
  });

  it("registers workspace routes", async () => {
    app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/workspaces/test-ws" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain("not found");
  });

  it("registers session routes", async () => {
    app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/workspaces/test-ws/session" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain("No active session");
  });

  it("requires auth for API routes when token is configured", async () => {
    process.env.HIVE_AUTH_TOKEN = "secret";
    app = await buildApp();

    const unauthorized = await app.inject({ method: "GET", url: "/api/projects" });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json()).toEqual({ error: "Unauthorized" });

    const authorized = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { authorization: "Bearer secret" },
    });
    expect(authorized.statusCode).toBe(200);
  });

  it("keeps /health public even when auth is configured", async () => {
    process.env.HIVE_AUTH_TOKEN = "secret";
    app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});
