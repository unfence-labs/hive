import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mocks = vi.hoisted(() => ({
  detectTools: vi.fn(),
}));

vi.mock("../services/setup/detect.js", () => ({
  detectTools: mocks.detectTools,
}));

import { setupRoutes } from "./setup.js";
import { getOperation } from "../services/setup/operations.js";
import type { SetupStepDef } from "../services/setup/installers/index.js";

let dataDir: string;
let app: ReturnType<typeof Fastify>;

/**
 * Stub step registry so these REST-surface tests never shell out or hit the
 * real installers. Each step emits a couple of lines and succeeds.
 */
function stubStep(title: string): SetupStepDef {
  return {
    title,
    fn: async (emit) => {
      await emit({ stream: "system", line: `${title}: starting` });
      await emit({ stream: "stdout", line: `${title}: done` });
    },
  };
}

const STUB_STEPS: Record<string, SetupStepDef> = {
  install_claude: stubStep("Install Claude Code"),
  install_gh: stubStep("Install GitHub CLI"),
  slow_step: {
    title: "Slow step",
    fn: async () => {
      await new Promise((r) => setTimeout(r, 200));
    },
  },
};

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "hive-setup-api-test-"));
  mocks.detectTools.mockResolvedValue({
    claude: { installed: true, version: "2.1.53", authenticated: true },
    node: { installed: true, version: "22.17.0" },
  });
  app = Fastify();
  await app.register((instance: FastifyInstance) =>
    setupRoutes(instance, {
      dataDir,
      // No-op token writer so the endpoint is testable without /etc/hive.
      claudeTokenWriter: async () => ({ persisted: false }),
      // Stub registry keeps the REST tests hermetic (no real installers).
      steps: STUB_STEPS,
    }),
  );
  await app.ready();
});

afterEach(async () => {
  await app.close();
  // Retry once: a fire-and-forget runner may still be flushing a final write.
  await rm(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
  vi.clearAllMocks();
});

/** Poll the operation until it reaches a terminal status (or times out). */
async function waitForTerminal(id: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const op = await getOperation(id, dataDir);
    if (op && (op.status === "succeeded" || op.status === "failed")) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`operation ${id} did not finish`);
}

describe("GET /api/setup/status", () => {
  it("returns detected tools and operations", async () => {
    const res = await app.inject({ method: "GET", url: "/api/setup/status" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.detected.claude).toEqual({ installed: true, version: "2.1.53", authenticated: true });
    expect(Array.isArray(body.operations)).toBe(true);
    expect(body.operations).toHaveLength(0);
  });
});

describe("POST /api/setup/run", () => {
  it("creates an operation and returns its id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/setup/run",
      payload: { steps: ["install_claude", "install_gh"] },
    });
    expect(res.statusCode).toBe(200);
    const { operationId } = res.json();
    expect(operationId).toMatch(/^op-/);

    await waitForTerminal(operationId);
    const op = await getOperation(operationId, dataDir);
    expect(op?.status).toBe("succeeded");
    expect(op?.steps.map((s) => s.id)).toEqual(["install_claude", "install_gh"]);
  });

  it("rejects an empty step list", async () => {
    const res = await app.inject({ method: "POST", url: "/api/setup/run", payload: { steps: [] } });
    expect(res.statusCode).toBe(400);
  });

  it("rejects unknown steps", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/setup/run",
      payload: { steps: ["not_a_real_step"] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("not_a_real_step");
  });

  it("returns 409 with code CONCURRENT_RUN while the same step is running", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/setup/run",
      payload: { steps: ["slow_step"] },
    });
    expect(first.statusCode).toBe(200);
    for (let i = 0; i < 100; i++) {
      const op = await getOperation(first.json().operationId, dataDir);
      if (op?.status === "running") break;
      await new Promise((r) => setTimeout(r, 5));
    }

    const second = await app.inject({
      method: "POST",
      url: "/api/setup/run",
      payload: { steps: ["slow_step"] },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("CONCURRENT_RUN");
    expect(second.json().operationId).toBe(first.json().operationId);

    await waitForTerminal(first.json().operationId);
  });

  it("appears in /status operations after running", async () => {
    const run = await app.inject({
      method: "POST",
      url: "/api/setup/run",
      payload: { steps: ["install_gh"] },
    });
    await waitForTerminal(run.json().operationId);

    const status = await app.inject({ method: "GET", url: "/api/setup/status" });
    expect(status.json().operations).toHaveLength(1);
  });
});

describe("GET /api/setup/operations/:id", () => {
  it("returns 404 for a missing operation", async () => {
    const res = await app.inject({ method: "GET", url: "/api/setup/operations/op-missing" });
    expect(res.statusCode).toBe(404);
  });

  it("returns the operation state", async () => {
    const run = await app.inject({
      method: "POST",
      url: "/api/setup/run",
      payload: { steps: ["install_gh"] },
    });
    const id = run.json().operationId;
    await waitForTerminal(id);

    const res = await app.inject({ method: "GET", url: `/api/setup/operations/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(id);
  });
});

describe("POST /api/setup/operations/:id/retry", () => {
  it("re-runs and succeeds for a completed op", async () => {
    const run = await app.inject({
      method: "POST",
      url: "/api/setup/run",
      payload: { steps: ["install_gh"] },
    });
    const id = run.json().operationId;
    await waitForTerminal(id);

    const retry = await app.inject({ method: "POST", url: `/api/setup/operations/${id}/retry` });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().operationId).toBe(id);
    await waitForTerminal(id);
    // Let the fire-and-forget runner settle its final writes before cleanup.
    await new Promise((r) => setTimeout(r, 30));
    expect((await getOperation(id, dataDir))?.status).toBe("succeeded");
  });

  it("returns 404 for a missing operation", async () => {
    const res = await app.inject({ method: "POST", url: "/api/setup/operations/op-x/retry" });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/setup/auth/claude/token", () => {
  it("accepts a well-formed token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/setup/auth/claude/token",
      payload: { token: "sk-ant-oat01-abcdef123" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, persisted: false });
  });

  it("rejects a malformed token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/setup/auth/claude/token",
      payload: { token: "nope" },
    });
    expect(res.statusCode).toBe(400);
  });
});
