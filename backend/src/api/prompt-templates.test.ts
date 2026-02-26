import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { createTempDir } from "../utils/test-helpers.js";
import { promptTemplateRoutes } from "./prompt-templates.js";
import { automationRoutes } from "./automations.js";
import { savePromptTemplates } from "../state/prompt-templates.js";
import { saveAutomations } from "../state/automations.js";
import type { PromptTemplate, Automation } from "../types.js";

let tmpDir: string;
let dataDir: string;
let app: FastifyInstance;

function makeTemplate(overrides: Partial<PromptTemplate> = {}): PromptTemplate {
  return {
    id: "tpl-1",
    name: "System Prompt",
    type: "system",
    content: "You are helpful.",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await createTempDir();
  dataDir = join(tmpDir, "data");
  app = Fastify();
  await app.register((instance) => promptTemplateRoutes(instance, { dataDir }));
  await app.register((instance) => automationRoutes(instance, { dataDir }));
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe("GET /api/prompt-templates", () => {
  it("returns empty list initially", async () => {
    const res = await app.inject({ method: "GET", url: "/api/prompt-templates" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("returns saved templates", async () => {
    await savePromptTemplates([makeTemplate()], dataDir);
    const res = await app.inject({ method: "GET", url: "/api/prompt-templates" });
    expect(res.json()).toHaveLength(1);
  });
});

describe("POST /api/prompt-templates", () => {
  it("creates a template (201)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/prompt-templates",
      payload: { name: "My Template", type: "user", content: "Run tests" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toMatch(/^tpl-/);
    expect(body.name).toBe("My Template");
    expect(body.type).toBe("user");
  });

  it("rejects missing name (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/prompt-templates",
      payload: { type: "system", content: "text" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects invalid type (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/prompt-templates",
      payload: { name: "X", type: "invalid", content: "text" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects missing content (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/prompt-templates",
      payload: { name: "X", type: "system" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("PUT /api/prompt-templates/:id", () => {
  it("updates a template", async () => {
    await savePromptTemplates([makeTemplate()], dataDir);
    const res = await app.inject({
      method: "PUT",
      url: "/api/prompt-templates/tpl-1",
      payload: { name: "Updated Name" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Updated Name");
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/prompt-templates/unknown",
      payload: { name: "X" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /api/prompt-templates/:id", () => {
  it("deletes a template (204)", async () => {
    await savePromptTemplates([makeTemplate()], dataDir);
    const res = await app.inject({ method: "DELETE", url: "/api/prompt-templates/tpl-1" });
    expect(res.statusCode).toBe(204);
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/prompt-templates/unknown" });
    expect(res.statusCode).toBe(404);
  });

  it("blocks deletion when referenced by automation (409)", async () => {
    await savePromptTemplates([makeTemplate()], dataDir);
    const auto: Automation = {
      id: "auto-1",
      name: "Test",
      enabled: true,
      trigger: { type: "cron", expression: "0 * * * *" },
      action: { type: "agent", modelId: "m", systemPromptId: "tpl-1", userPromptInline: "test" },
      notification: { onComplete: true, onFailure: true },
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    await saveAutomations([auto], dataDir);

    const res = await app.inject({ method: "DELETE", url: "/api/prompt-templates/tpl-1" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("referenced by automation");
  });
});
