/**
 * Extended prompt template API tests covering edge cases, update behavior,
 * and deletion guard exhaustive scenarios.
 */
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

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "auto-1",
    name: "Test Auto",
    enabled: true,
    trigger: { type: "cron", expression: "0 * * * *" },
    action: { type: "agent", modelId: "m", userPromptInline: "test" },
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
  await app.register((instance) => promptTemplateRoutes(instance, { dataDir }));
  await app.register((instance) => automationRoutes(instance, { dataDir }));
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe("POST /api/prompt-templates - edge cases", () => {
  it("rejects whitespace-only name", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/prompt-templates",
      payload: { name: "   ", type: "system", content: "text" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Name is required");
  });

  it("rejects whitespace-only content", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/prompt-templates",
      payload: { name: "Test", type: "system", content: "   " },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Content is required");
  });

  it("trims name and content", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/prompt-templates",
      payload: { name: "  Padded  ", type: "user", content: "  text  " },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe("Padded");
    expect(res.json().content).toBe("text");
  });

  it("generates unique IDs for each template", async () => {
    const res1 = await app.inject({
      method: "POST",
      url: "/api/prompt-templates",
      payload: { name: "T1", type: "system", content: "a" },
    });
    const res2 = await app.inject({
      method: "POST",
      url: "/api/prompt-templates",
      payload: { name: "T2", type: "user", content: "b" },
    });
    expect(res1.json().id).not.toBe(res2.json().id);
  });

  it("sets createdAt and updatedAt timestamps", async () => {
    const before = new Date().toISOString();
    const res = await app.inject({
      method: "POST",
      url: "/api/prompt-templates",
      payload: { name: "Timed", type: "system", content: "text" },
    });
    const after = new Date().toISOString();
    const body = res.json();
    expect(body.createdAt >= before).toBe(true);
    expect(body.createdAt <= after).toBe(true);
    expect(body.updatedAt).toBe(body.createdAt);
  });

  it("accepts both system and user type", async () => {
    const res1 = await app.inject({
      method: "POST",
      url: "/api/prompt-templates",
      payload: { name: "Sys", type: "system", content: "a" },
    });
    const res2 = await app.inject({
      method: "POST",
      url: "/api/prompt-templates",
      payload: { name: "Usr", type: "user", content: "b" },
    });
    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);
    expect(res1.json().type).toBe("system");
    expect(res2.json().type).toBe("user");
  });
});

describe("PUT /api/prompt-templates/:id - edge cases", () => {
  it("trims updated name and content", async () => {
    await savePromptTemplates([makeTemplate()], dataDir);
    const res = await app.inject({
      method: "PUT",
      url: "/api/prompt-templates/tpl-1",
      payload: { name: "  Updated  ", content: "  new content  " },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Updated");
    expect(res.json().content).toBe("new content");
  });

  it("preserves unchanged fields", async () => {
    await savePromptTemplates([makeTemplate()], dataDir);
    const res = await app.inject({
      method: "PUT",
      url: "/api/prompt-templates/tpl-1",
      payload: { name: "New Name" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("New Name");
    expect(res.json().content).toBe("You are helpful."); // unchanged
    expect(res.json().type).toBe("system"); // unchanged
  });

  it("updates updatedAt timestamp", async () => {
    await savePromptTemplates([makeTemplate({ updatedAt: "2026-01-01T00:00:00Z" })], dataDir);
    const res = await app.inject({
      method: "PUT",
      url: "/api/prompt-templates/tpl-1",
      payload: { name: "Updated" },
    });
    expect(res.json().updatedAt > "2026-01-01T00:00:00Z").toBe(true);
  });

  it("persists the update to disk", async () => {
    await savePromptTemplates([makeTemplate()], dataDir);
    await app.inject({
      method: "PUT",
      url: "/api/prompt-templates/tpl-1",
      payload: { content: "Updated content" },
    });

    // Verify via GET
    const list = await app.inject({ method: "GET", url: "/api/prompt-templates" });
    expect(list.json()[0].content).toBe("Updated content");
  });
});

describe("DELETE /api/prompt-templates/:id - deletion guard", () => {
  it("blocks deletion when referenced as user prompt by automation", async () => {
    await savePromptTemplates([makeTemplate({ id: "tpl-user", type: "user" })], dataDir);
    await saveAutomations([
      makeAutomation({ action: { type: "agent", modelId: "m", userPromptId: "tpl-user" } }),
    ], dataDir);

    const res = await app.inject({ method: "DELETE", url: "/api/prompt-templates/tpl-user" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("referenced by automation");
  });

  it("allows deletion of unreferenced template even when automations exist", async () => {
    await savePromptTemplates([
      makeTemplate({ id: "tpl-1" }),
      makeTemplate({ id: "tpl-2", name: "Other" }),
    ], dataDir);
    // Automation only references tpl-1
    await saveAutomations([
      makeAutomation({ action: { type: "agent", modelId: "m", systemPromptId: "tpl-1", userPromptInline: "test" } }),
    ], dataDir);

    const res = await app.inject({ method: "DELETE", url: "/api/prompt-templates/tpl-2" });
    expect(res.statusCode).toBe(204);
  });

  it("shows the referencing automation name in the error", async () => {
    await savePromptTemplates([makeTemplate()], dataDir);
    await saveAutomations([
      makeAutomation({ name: "Daily Review", action: { type: "agent", modelId: "m", systemPromptId: "tpl-1", userPromptInline: "test" } }),
    ], dataDir);

    const res = await app.inject({ method: "DELETE", url: "/api/prompt-templates/tpl-1" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("Daily Review");
  });

  it("persists deletion to disk", async () => {
    await savePromptTemplates([
      makeTemplate({ id: "tpl-1" }),
      makeTemplate({ id: "tpl-2", name: "Second" }),
    ], dataDir);

    await app.inject({ method: "DELETE", url: "/api/prompt-templates/tpl-1" });

    const list = await app.inject({ method: "GET", url: "/api/prompt-templates" });
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0].id).toBe("tpl-2");
  });
});
