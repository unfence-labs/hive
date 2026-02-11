import { describe, it, expect, afterEach, vi, beforeAll } from "vitest";

// Prevent the top-level main() from actually listening on a port
vi.mock("fastify", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fastify")>();
  const originalDefault = actual.default;
  return {
    ...actual,
    default: (...args: Parameters<typeof originalDefault>) => {
      const instance = originalDefault(...args);
      const originalListen = instance.listen.bind(instance);
      instance.listen = (async (...listenArgs: unknown[]) => {
        // Only block the main() auto-listen (which uses port 3000)
        const opts = listenArgs[0] as { port?: number } | undefined;
        if (opts?.port === 3000) {
          return "mocked";
        }
        return originalListen(...listenArgs);
      }) as typeof instance.listen;
      return instance;
    },
  };
});

import { buildApp } from "./index.js";

let app: Awaited<ReturnType<typeof buildApp>>;

afterEach(async () => {
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
});
