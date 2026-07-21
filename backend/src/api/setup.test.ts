import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { setupRoutes } from "./setup.js";
import type { SetupStepDef } from "../services/setup/installers/index.js";

const mocks = vi.hoisted(() => ({ detectTools: vi.fn() }));
vi.mock("../services/setup/detect.js", () => ({ detectTools: mocks.detectTools }));

let app: ReturnType<typeof Fastify>;
let releaseSlowStep: (() => void) | undefined;
let tokenWriter: ReturnType<typeof vi.fn<(token: string) => Promise<void>>>;

const STUB_STEPS: Record<string, SetupStepDef> = {
  install_claude: { title: "Install Claude Code", fn: async () => {} },
  auth_gh: { title: "Authenticate GitHub", fn: async () => {} },
  slow_step: {
    title: "Slow step",
    fn: async () => new Promise<void>((resolve) => {
      releaseSlowStep = resolve;
    }),
  },
};

async function makeApp(): Promise<ReturnType<typeof Fastify>> {
  const instance = Fastify();
  await instance.register((scope: FastifyInstance) =>
    setupRoutes(scope, {
      dataDir: "/unused-in-memory-operations",
      claudeTokenWriter: tokenWriter,
      steps: STUB_STEPS,
    }),
  );
  await instance.ready();
  return instance;
}

beforeEach(async () => {
  releaseSlowStep = undefined;
  tokenWriter = vi.fn(async () => {});
  mocks.detectTools.mockResolvedValue({
    gh: { installed: true, authenticated: false },
    claude: { installed: true, authenticated: true },
    codex: { installed: false, authenticated: false },
  });
  app = await makeApp();
});

afterEach(async () => {
  releaseSlowStep?.();
  await app.close();
  vi.clearAllMocks();
});

async function waitForTerminal(instance: ReturnType<typeof Fastify>, id: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await instance.inject({
      method: "GET",
      url: `/api/setup/operations/${id}`,
    });
    if (response.statusCode === 200 && response.json().status !== "running") return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`Operation ${id} did not finish`);
}

describe("GET /api/setup/status", () => {
  it("returns only current tool detection", async () => {
    const response = await app.inject({ method: "GET", url: "/api/setup/status" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      detected: {
        gh: { installed: true, authenticated: false },
        claude: { installed: true, authenticated: true },
        codex: { installed: false, authenticated: false },
      },
    });
  });
});

describe("POST /api/setup/run", () => {
  it("creates a pollable operation with an exact id shape", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/setup/run",
      payload: { steps: ["install_claude", "auth_gh"] },
    });
    expect(response.statusCode).toBe(200);
    const id = response.json().operationId as string;
    expect(id).toMatch(/^op-[A-Za-z0-9_-]{8}$/);

    await waitForTerminal(app, id);
    const operation = await app.inject({
      method: "GET",
      url: `/api/setup/operations/${id}`,
    });
    expect(operation.json()).toMatchObject({
      id,
      status: "succeeded",
      steps: [{ id: "install_claude" }, { id: "auth_gh" }],
    });
  });

  it.each([
    {},
    { steps: [] },
    { steps: ["missing"] },
    { steps: ["install_claude", "install_claude"] },
    { steps: ["install_claude"], options: {} },
    { steps: "install_claude" },
    { steps: ["toString"] },
    { steps: ["__proto__"] },
  ])("rejects an invalid body %#", async (payload) => {
    const response = await app.inject({ method: "POST", url: "/api/setup/run", payload });
    expect(response.statusCode).toBe(400);
  });

  it("atomically rejects simultaneous overlapping requests", async () => {
    const [first, second] = await Promise.all([
      app.inject({ method: "POST", url: "/api/setup/run", payload: { steps: ["slow_step"] } }),
      app.inject({ method: "POST", url: "/api/setup/run", payload: { steps: ["slow_step"] } }),
    ]);
    const accepted = [first, second].find((response) => response.statusCode === 200);
    const rejected = [first, second].find((response) => response.statusCode === 409);
    expect(accepted).toBeDefined();
    expect(rejected?.json()).toMatchObject({
      code: "CONCURRENT_RUN",
      operationId: accepted?.json().operationId,
    });
    releaseSlowStep?.();
    await waitForTerminal(app, accepted!.json().operationId);
  });

  it("allows disjoint operations", async () => {
    const slow = await app.inject({
      method: "POST",
      url: "/api/setup/run",
      payload: { steps: ["slow_step"] },
    });
    const other = await app.inject({
      method: "POST",
      url: "/api/setup/run",
      payload: { steps: ["install_claude"] },
    });
    expect(slow.statusCode).toBe(200);
    expect(other.statusCode).toBe(200);
    releaseSlowStep?.();
    await waitForTerminal(app, slow.json().operationId);
    await waitForTerminal(app, other.json().operationId);
  });
});

describe("GET /api/setup/operations/:id", () => {
  it("validates ids and returns 404 for a valid missing id", async () => {
    expect((await app.inject({
      method: "GET",
      url: "/api/setup/operations/not-an-operation",
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: "GET",
      url: "/api/setup/operations/op-12345678",
    })).statusCode).toBe(404);
  });

  it("does not expose the removed retry endpoint", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/setup/operations/op-12345678/retry",
    });
    expect(response.statusCode).toBe(404);
  });

  it("does not expose operations through a new runner after restart", async () => {
    const run = await app.inject({
      method: "POST",
      url: "/api/setup/run",
      payload: { steps: ["install_claude"] },
    });
    const id = run.json().operationId as string;
    await waitForTerminal(app, id);

    const restarted = await makeApp();
    try {
      const response = await restarted.inject({
        method: "GET",
        url: `/api/setup/operations/${id}`,
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await restarted.close();
    }
  });
});

describe("POST /api/setup/auth/claude/token", () => {
  it("writes a valid token before returning success", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/setup/auth/claude/token",
      payload: { token: "  sk-ant-oat01-abcdef123  " },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(tokenWriter).toHaveBeenCalledWith("sk-ant-oat01-abcdef123");
  });

  it("rejects malformed payloads and tokens", async () => {
    expect((await app.inject({
      method: "POST",
      url: "/api/setup/auth/claude/token",
      payload: { token: "nope" },
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: "POST",
      url: "/api/setup/auth/claude/token",
      payload: { token: "sk-ant-oat01-valid", extra: true },
    })).statusCode).toBe(400);
  });

  it("does not report success when persistence fails", async () => {
    tokenWriter.mockRejectedValueOnce(new Error("disk full"));
    const response = await app.inject({
      method: "POST",
      url: "/api/setup/auth/claude/token",
      payload: { token: "sk-ant-oat01-abcdef123" },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).not.toHaveProperty("ok", true);
  });
});
