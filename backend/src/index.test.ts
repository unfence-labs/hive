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
  delete process.env.HIVE_RATE_LIMIT_MAX;
  delete process.env.HIVE_RATE_LIMIT_WINDOW_MS;
  delete process.env.HIVE_CLAUDE_SKIP_PERMISSIONS;
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

  it("adds CORS headers for API requests with an Origin", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { origin: "http://localhost:5173" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });

  it("responds to CORS preflight requests", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/projects",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "GET",
      },
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(res.headers["access-control-allow-methods"]).toContain("GET");
  });

  it("allows DELETE in CORS preflight", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/workspaces/test-ws/sessions/test-session",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "DELETE",
      },
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-methods"]).toContain("DELETE");
  });

  it("allows PATCH in CORS preflight", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/projects",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "PATCH",
      },
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-methods"]).toContain("PATCH");
  });

  it("allows PUT in CORS preflight", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/projects",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "PUT",
      },
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-methods"]).toContain("PUT");
  });

  it("includes all standard HTTP methods in CORS allowed methods", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/projects",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "GET",
      },
    });

    const allowed = res.headers["access-control-allow-methods"] as string;
    for (const method of ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"]) {
      expect(allowed).toContain(method);
    }
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

  it("rate-limits API requests when threshold is exceeded", async () => {
    process.env.HIVE_RATE_LIMIT_MAX = "2";
    process.env.HIVE_RATE_LIMIT_WINDOW_MS = "60000";
    app = await buildApp();

    const first = await app.inject({ method: "GET", url: "/api/projects" });
    const second = await app.inject({ method: "GET", url: "/api/projects" });
    const third = await app.inject({ method: "GET", url: "/api/projects" });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(third.statusCode).toBe(429);
    expect(third.json().error).toContain("Rate limit exceeded");
  });
});
