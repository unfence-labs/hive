import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { createTempDir } from "../utils/test-helpers.js";
import { agentRoutes } from "./agent-definitions.js";
import { saveAgents } from "../state/agents.js";
import { saveAutomations } from "../state/automations.js";
import type { Agent, Automation } from "../types.js";

let tmpDir: string;
let dataDir: string;
let app: FastifyInstance;

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    name: "Code Auditor",
    description: "Reviews code",
    systemPrompt: "You are a code reviewer.",
    modelId: "claude:sonnet-4-6",
    injectGitContext: true,
    readOnly: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await createTempDir();
  dataDir = join(tmpDir, "data");
  app = Fastify();
  await app.register((instance) => agentRoutes(instance, { dataDir }));
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe("GET /api/agents", () => {
  it("returns empty list initially", async () => {
    const res = await app.inject({ method: "GET", url: "/api/agents" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("returns saved agents", async () => {
    await saveAgents([makeAgent()], dataDir);
    const res = await app.inject({ method: "GET", url: "/api/agents" });
    expect(res.json()).toHaveLength(1);
  });
});

describe("POST /api/agents", () => {
  it("creates an agent (201)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/agents",
      payload: {
        name: "My Agent",
        description: "Does things",
        systemPrompt: "You are helpful.",
        modelId: "claude:sonnet-4-6",
        injectGitContext: false,
        readOnly: true,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toMatch(/^agent-/);
    expect(body.name).toBe("My Agent");
    expect(body.injectGitContext).toBe(false);
    expect(body.readOnly).toBe(true);
  });

  it("rejects missing name (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/agents",
      payload: { systemPrompt: "x", modelId: "m", injectGitContext: true, readOnly: false },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects missing systemPrompt (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/agents",
      payload: { name: "X", modelId: "m", injectGitContext: true, readOnly: false },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects missing modelId (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/agents",
      payload: { name: "X", systemPrompt: "p", injectGitContext: true, readOnly: false },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an unknown modelId (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/agents",
      payload: {
        name: "X",
        systemPrompt: "p",
        modelId: "claude:does-not-exist",
        injectGitContext: true,
        readOnly: false,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Unknown model");
  });
});

describe("PATCH /api/agents/:id", () => {
  it("updates an agent", async () => {
    await saveAgents([makeAgent()], dataDir);
    const res = await app.inject({
      method: "PATCH",
      url: "/api/agents/agent-1",
      payload: { name: "Updated Name", readOnly: false },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("Updated Name");
    expect(body.readOnly).toBe(false);
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/agents/unknown",
      payload: { name: "X" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects blanking a required field (400)", async () => {
    await saveAgents([makeAgent()], dataDir);
    for (const field of ["name", "systemPrompt", "modelId"]) {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/agents/agent-1",
        payload: { [field]: "   " },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it("rejects updating to an unknown modelId (400)", async () => {
    await saveAgents([makeAgent()], dataDir);
    const res = await app.inject({
      method: "PATCH",
      url: "/api/agents/agent-1",
      payload: { modelId: "claude:does-not-exist" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Unknown model");
  });
});

describe("DELETE /api/agents/:id", () => {
  it("deletes an agent (204)", async () => {
    await saveAgents([makeAgent()], dataDir);
    const res = await app.inject({ method: "DELETE", url: "/api/agents/agent-1" });
    expect(res.statusCode).toBe(204);
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/agents/unknown" });
    expect(res.statusCode).toBe(404);
  });

  it("blocks deletion when referenced by automation (409)", async () => {
    await saveAgents([makeAgent()], dataDir);
    const auto: Automation = {
      id: "auto-1",
      name: "Nightly Audit",
      enabled: true,
      trigger: { type: "cron", expression: "0 * * * *" },
      action: { type: "agent", agentId: "agent-1", userPromptInline: "Audit the repo" },
      notification: { onComplete: true, onFailure: true },
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    await saveAutomations([auto], dataDir);

    const res = await app.inject({ method: "DELETE", url: "/api/agents/agent-1" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("referenced by automation");
  });
});
