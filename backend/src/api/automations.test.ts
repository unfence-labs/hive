import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { createTempDir } from "../utils/test-helpers.js";
import { automationRoutes } from "./automations.js";
import { promptTemplateRoutes } from "./prompt-templates.js";
import { saveAutomations } from "../state/automations.js";
import type { Automation } from "../types.js";

let tmpDir: string;
let dataDir: string;
let app: FastifyInstance;

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "auto-1",
    name: "Test Auto",
    enabled: true,
    trigger: { type: "cron", expression: "0 * * * *" },
    action: { type: "agent", modelId: "claude:opus-4-6", userPromptInline: "Do something" },
    notification: { onComplete: true, onFailure: true },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await createTempDir();
  dataDir = join(tmpDir, "data");
  app = Fastify();
  await app.register((instance) => automationRoutes(instance, { dataDir }));
  await app.register((instance) => promptTemplateRoutes(instance, { dataDir }));
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe("GET /api/automations", () => {
  it("returns empty list initially", async () => {
    const res = await app.inject({ method: "GET", url: "/api/automations" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("returns saved automations", async () => {
    await saveAutomations([makeAutomation()], dataDir);
    const res = await app.inject({ method: "GET", url: "/api/automations" });
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].name).toBe("Test Auto");
  });
});

describe("POST /api/automations", () => {
  it("creates an automation (201)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/automations",
      payload: {
        name: "My Auto",
        trigger: { type: "cron", expression: "0 2 * * *" },
        action: { type: "agent", modelId: "claude:opus-4-6", userPromptInline: "Audit code" },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toMatch(/^auto-/);
    expect(body.name).toBe("My Auto");
    expect(body.enabled).toBe(true);
  });

  it("rejects missing name (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/automations",
      payload: {
        trigger: { type: "cron", expression: "0 * * * *" },
        action: { type: "agent", modelId: "m", userPromptInline: "test" },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects invalid cron expression (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/automations",
      payload: {
        name: "Bad Cron",
        trigger: { type: "cron", expression: "not-valid" },
        action: { type: "agent", modelId: "m", userPromptInline: "test" },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Invalid cron");
  });

  it("rejects missing user prompt (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/automations",
      payload: {
        name: "No Prompt",
        trigger: { type: "cron", expression: "0 * * * *" },
        action: { type: "agent", modelId: "m" },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("user prompt is required");
  });

  it("rejects both systemPromptId and systemPromptInline (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/automations",
      payload: {
        name: "Both",
        trigger: { type: "cron", expression: "0 * * * *" },
        action: {
          type: "agent",
          modelId: "m",
          systemPromptId: "tpl-1",
          systemPromptInline: "inline",
          userPromptInline: "test",
        },
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/automations/:id", () => {
  it("returns 404 for unknown id", async () => {
    const res = await app.inject({ method: "GET", url: "/api/automations/unknown" });
    expect(res.statusCode).toBe(404);
  });

  it("returns a single automation", async () => {
    await saveAutomations([makeAutomation()], dataDir);
    const res = await app.inject({ method: "GET", url: "/api/automations/auto-1" });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Test Auto");
  });
});

describe("PUT /api/automations/:id", () => {
  it("updates an automation", async () => {
    await saveAutomations([makeAutomation()], dataDir);
    const res = await app.inject({
      method: "PUT",
      url: "/api/automations/auto-1",
      payload: { name: "Updated", enabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Updated");
    expect(res.json().enabled).toBe(false);
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/automations/unknown",
      payload: { name: "X" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /api/automations/:id", () => {
  it("deletes an automation (204)", async () => {
    await saveAutomations([makeAutomation()], dataDir);
    const res = await app.inject({ method: "DELETE", url: "/api/automations/auto-1" });
    expect(res.statusCode).toBe(204);
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/automations/unknown" });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/automations/:id/runs", () => {
  it("returns 404 for unknown automation", async () => {
    const res = await app.inject({ method: "GET", url: "/api/automations/unknown/runs" });
    expect(res.statusCode).toBe(404);
  });

  it("returns empty runs for existing automation", async () => {
    await saveAutomations([makeAutomation()], dataDir);
    const res = await app.inject({ method: "GET", url: "/api/automations/auto-1/runs" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe("POST /api/automations/:id/trigger", () => {
  it("returns 503 when no scheduler is available", async () => {
    await saveAutomations([makeAutomation()], dataDir);
    const res = await app.inject({ method: "POST", url: "/api/automations/auto-1/trigger" });
    expect(res.statusCode).toBe(503);
  });
});
