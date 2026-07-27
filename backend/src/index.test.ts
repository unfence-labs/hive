import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Prevent the top-level main() from running preflight checks (claude not on CI)
vi.mock("./utils/preflight.js", () => ({ preflight: vi.fn() }));

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
        // Only block the main() auto-listen (uses PORT env var or defaults to 3000)
        const opts = listenArgs[0] as { port?: number } | undefined;
        const mainPort = Number(process.env.PORT ?? 3000);
        if (opts?.port === mainPort) {
          return "mocked";
        }
        return originalListen(opts as Parameters<typeof originalListen>[0]);
      }) as typeof instance.listen;
      return instance;
    },
  };
});

import { buildApp } from "./index.js";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

let app: Awaited<ReturnType<typeof buildApp>>;
let tempDataDir: string;
let previousDataDir: string | undefined;

beforeEach(async () => {
  tempDataDir = await mkdtemp(join(tmpdir(), "hive-index-test-"));
  previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDataDir;
});

afterEach(async () => {
  delete process.env.HIVE_AUTH_TOKEN;
  delete process.env.HIVE_AUTH_TOKEN_SHA256;
  delete process.env.HIVE_ALLOWED_HOSTS;
  delete process.env.HIVE_ALLOWED_ORIGINS;
  delete process.env.HIVE_RATE_LIMIT_MAX;
  delete process.env.HIVE_RATE_LIMIT_WINDOW_MS;
  delete process.env.HIVE_CLAUDE_SKIP_PERMISSIONS;
  vi.restoreAllMocks();
  if (previousDataDir === undefined) {
    delete process.env.DATA_DIR;
  } else {
    process.env.DATA_DIR = previousDataDir;
  }
  await app?.close();
  await rm(tempDataDir, { recursive: true, force: true });
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
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body).toHaveProperty("env");
  });

  it("registers project routes", async () => {
    app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/projects" });
    expect(res.statusCode).not.toBe(404);
  });

  it("registers brain routes", async () => {
    app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/brain" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ exists: false });
  });

  it("registers workspace routes", async () => {
    app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/workspaces/test-ws" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain("not found");
  });

  it("registers settings routes", async () => {
    app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/settings/notifications" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      telegram: {
        enabled: expect.any(Boolean),
        botToken: expect.any(String),
        chatId: expect.any(String),
      },
      apns: {
        enabled: expect.any(Boolean),
        teamId: expect.any(String),
        keyId: expect.any(String),
        keyContent: expect.any(String),
        bundleId: expect.any(String),
        sandbox: expect.any(Boolean),
        deviceTokens: expect.any(Array),
      },
    });
  });

  it("registers setup tool routes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Not Found", { status: 404 }),
    );
    app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/setup/tools" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      tools: expect.any(Array),
      operations: expect.any(Array),
    });
  });

  it("registers skill settings routes", async () => {
    app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/settings/skills" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      skills: expect.any(Array),
    });
  });

  it("registers subagent settings routes", async () => {
    app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/settings/subagents" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      agents: expect.any(Array),
    });
  });

  it("registers session routes", async () => {
    app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/workspaces/test-ws/session" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain("No active session");
  });

  it("registers script routes", async () => {
    app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/workspaces/test-ws/scripts" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Workspace not found" });
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
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body).toHaveProperty("env");
  });

  it("requires auth for API routes when only the token hash is configured", async () => {
    process.env.HIVE_AUTH_TOKEN_SHA256 = sha256Hex("hashed-secret");
    app = await buildApp();

    const unauthorized = await app.inject({ method: "GET", url: "/api/projects" });
    expect(unauthorized.statusCode).toBe(401);

    const wrong = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { authorization: "Bearer nope" },
    });
    expect(wrong.statusCode).toBe(401);

    const authorized = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { authorization: "Bearer hashed-secret" },
    });
    expect(authorized.statusCode).toBe(200);
  });

  it("accepts the hashed token through the ?token= query param", async () => {
    process.env.HIVE_AUTH_TOKEN_SHA256 = sha256Hex("hashed-secret");
    app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/api/projects?token=hashed-secret" });
    expect(res.statusCode).toBe(200);
  });

  it("stays open when neither token nor token hash is configured", async () => {
    app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/projects" });
    expect(res.statusCode).toBe(200);
  });

  it("enforces the same expectation on WebSocket endpoints as on REST", async () => {
    process.env.HIVE_AUTH_TOKEN_SHA256 = sha256Hex("ws-secret");
    app = await buildApp();
    await app.ready();

    const wsPaths = [
      "/ws/hub",
      "/ws/script/ws-1?type=setup",
      "/ws/terminal/ws-1?sessionId=session-1",
      "/ws/browser/ws-1/session-1",
    ];
    for (const path of wsPaths) {
      await expect(app.injectWS(path, { headers: { host: "localhost" } })).rejects.toThrow(
        "Unexpected server response: 401",
      );
    }

    const socket = await app.injectWS("/ws/hub?token=ws-secret", {
      headers: { host: "localhost" },
    });
    const firstFrame = await Promise.race([
      new Promise<string>((resolve) => {
        socket.once("message", (data) => resolve(data.toString()));
      }),
      new Promise<string>((resolve) => setTimeout(() => resolve(""), 150)),
    ]);
    expect(firstFrame).not.toContain("Unauthorized");
    expect(socket.readyState).toBe(socket.OPEN);
    socket.close();
  });

  it("rejects a Host header that is not an IP, localhost or a MagicDNS name", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { host: "evil.example.com" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "Forbidden host" });
  });

  it("keeps the Host guard on even when auth is configured", async () => {
    process.env.HIVE_AUTH_TOKEN = "secret";
    app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { host: "evil.example.com", authorization: "Bearer secret" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("accepts a Host header listed in HIVE_ALLOWED_HOSTS", async () => {
    process.env.HIVE_ALLOWED_HOSTS = "hive.example.com";
    app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { host: "hive.example.com" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("accepts tailnet and IP Host headers", async () => {
    app = await buildApp();
    for (const host of ["100.74.156.118:3000", "hive.tailnet-abc.ts.net"]) {
      const res = await app.inject({ method: "GET", url: "/api/projects", headers: { host } });
      expect(res.statusCode).toBe(200);
    }
  });

  it("keeps /health reachable from a disallowed Host", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: { host: "evil.example.com" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("serves /health with an open CORS header and no secrets", async () => {
    process.env.HIVE_AUTH_TOKEN = "secret";
    app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://attacker.example" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.body).not.toContain("secret");
    expect(Object.keys(res.json())).toEqual(["status", "env", "system"]);
  });

  it("does not grant CORS to arbitrary web origins", async () => {
    app = await buildApp();
    const request = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { origin: "https://attacker.example" },
    });
    expect(request.headers).not.toHaveProperty("access-control-allow-origin");

    const preflight = await app.inject({
      method: "OPTIONS",
      url: "/api/projects",
      headers: {
        origin: "https://attacker.example",
        "access-control-request-method": "GET",
      },
    });
    expect(preflight.headers).not.toHaveProperty("access-control-allow-origin");
  });

  it("allows an exact origin configured through HIVE_ALLOWED_ORIGINS", async () => {
    process.env.HIVE_ALLOWED_ORIGINS = "https://hive.example.com";
    app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { origin: "https://hive.example.com" },
    });
    expect(res.headers["access-control-allow-origin"]).toBe("https://hive.example.com");
  });

  it("rejects a WebSocket upgrade from an untrusted browser origin", async () => {
    app = await buildApp();
    await app.ready();
    await expect(
      app.injectWS("/ws/hub", {
        headers: { host: "localhost", origin: "https://attacker.example" },
      }),
    ).rejects.toThrow("Unexpected server response: 403");

    const socket = await app.injectWS("/ws/hub", {
      headers: { host: "localhost", origin: "tauri://localhost" },
    });
    expect(socket.readyState).toBe(socket.OPEN);
    socket.close();
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

  it("rate-limits repeated failed authentications", async () => {
    process.env.HIVE_AUTH_TOKEN = "secret";
    process.env.HIVE_RATE_LIMIT_MAX = "2";
    process.env.HIVE_RATE_LIMIT_WINDOW_MS = "60000";
    app = await buildApp();

    const attempt = () =>
      app.inject({
        method: "GET",
        url: "/api/projects",
        headers: { authorization: "Bearer wrong" },
      });

    expect((await attempt()).statusCode).toBe(401);
    expect((await attempt()).statusCode).toBe(401);
    const throttled = await attempt();
    expect(throttled.statusCode).toBe(429);
    expect(throttled.json().error).toContain("Rate limit exceeded");

    // The limiter must not lock out an operator polling the open health probe.
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
  });

  it("rejects a repeated ?token= query param with 401 rather than 500", async () => {
    process.env.HIVE_AUTH_TOKEN = "secret";
    app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/api/projects?token=secret&token=other" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Unauthorized" });
  });
});
