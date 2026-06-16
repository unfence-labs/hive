/**
 * Extended automation API tests covering edge cases, update validation,
 * template reference validation, and scheduler integration hooks.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { createTempDir } from "../utils/test-helpers.js";
import { automationRoutes } from "./automations.js";
import { promptTemplateRoutes } from "./prompt-templates.js";
import { saveAutomations, addRun } from "../state/automations.js";
import { savePromptTemplates } from "../state/prompt-templates.js";
import { saveAgents } from "../state/agents.js";
import type { Agent, Automation, AutomationRun, PromptTemplate } from "../types.js";
import type { AutomationScheduler } from "../services/automation-scheduler.js";

let tmpDir: string;
let dataDir: string;
let app: FastifyInstance;

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    name: "Reviewer",
    systemPrompt: "You are a reviewer.",
    modelId: "claude:opus-4-8",
    injectGitContext: true,
    readOnly: false,
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
    action: { type: "agent", agentId: "agent-1", userPromptInline: "Do something" },
    notification: { onComplete: true, onFailure: true },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeTemplate(overrides: Partial<PromptTemplate> = {}): PromptTemplate {
  return {
    id: "tpl-1",
    name: "Task Prompt",
    type: "user",
    content: "Review the latest changes.",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeRun(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: "run-1",
    automationId: "auto-1",
    status: "success",
    sessionId: "sess-1",
    startedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ── Test suite WITHOUT scheduler ────────────────────────────────────

describe("Automation API - extended validation", () => {
  beforeEach(async () => {
    tmpDir = await createTempDir();
    dataDir = join(tmpDir, "data");
    app = Fastify();
    await app.register((instance) => automationRoutes(instance, { dataDir }));
    await app.register((instance) => promptTemplateRoutes(instance, { dataDir }));
    await app.ready();
    await saveAgents([makeAgent()], dataDir);
  });

  afterEach(async () => {
    await app.close();
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  describe("POST /api/automations - edge cases", () => {
    it("rejects whitespace-only name", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/automations",
        payload: {
          name: "   ",
          trigger: { type: "cron", expression: "0 * * * *" },
          action: { type: "agent", agentId: "agent-1", userPromptInline: "test" },
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("Name is required");
    });

    it("rejects missing trigger expression", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/automations",
        payload: {
          name: "Test",
          trigger: { type: "cron" },
          action: { type: "agent", agentId: "agent-1", userPromptInline: "test" },
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("Trigger expression is required");
    });

    it("rejects missing agentId", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/automations",
        payload: {
          name: "Test",
          trigger: { type: "cron", expression: "0 * * * *" },
          action: { type: "agent", userPromptInline: "test" },
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("agent is required");
    });

    it("rejects both userPromptId and userPromptInline", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/automations",
        payload: {
          name: "Dual User",
          trigger: { type: "cron", expression: "0 * * * *" },
          action: {
            type: "agent",
            agentId: "agent-1",
            userPromptId: "tpl-1",
            userPromptInline: "inline",
          },
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("either userPromptId or userPromptInline");
    });

    it("rejects non-existent agent reference", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/automations",
        payload: {
          name: "Bad Ref",
          trigger: { type: "cron", expression: "0 * * * *" },
          action: {
            type: "agent",
            agentId: "nonexistent",
            userPromptInline: "test",
          },
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("agent not found");
    });

    it("rejects non-existent user prompt template reference", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/automations",
        payload: {
          name: "Bad Ref",
          trigger: { type: "cron", expression: "0 * * * *" },
          action: {
            type: "agent",
            agentId: "agent-1",
            userPromptId: "nonexistent",
          },
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("user prompt template not found");
    });

    it("accepts valid user prompt template reference", async () => {
      await savePromptTemplates([makeTemplate()], dataDir);

      const res = await app.inject({
        method: "POST",
        url: "/api/automations",
        payload: {
          name: "With Ref",
          trigger: { type: "cron", expression: "0 * * * *" },
          action: {
            type: "agent",
            agentId: "agent-1",
            userPromptId: "tpl-1",
          },
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().action.userPromptId).toBe("tpl-1");
    });

    it("trims automation name", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/automations",
        payload: {
          name: "  Padded Name  ",
          trigger: { type: "cron", expression: "0 * * * *" },
          action: { type: "agent", agentId: "agent-1", userPromptInline: "test" },
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().name).toBe("Padded Name");
    });

    it("defaults notification settings to true", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/automations",
        payload: {
          name: "No Notif",
          trigger: { type: "cron", expression: "0 * * * *" },
          action: { type: "agent", agentId: "agent-1", userPromptInline: "test" },
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().notification).toEqual({ onComplete: true, onFailure: true });
    });

    it("respects custom notification settings", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/automations",
        payload: {
          name: "Custom Notif",
          trigger: { type: "cron", expression: "0 * * * *" },
          action: { type: "agent", agentId: "agent-1", userPromptInline: "test" },
          notification: { onComplete: false, onFailure: true },
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().notification).toEqual({ onComplete: false, onFailure: true });
    });

    it("sets enabled to true by default", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/automations",
        payload: {
          name: "New Auto",
          trigger: { type: "cron", expression: "0 * * * *" },
          action: { type: "agent", agentId: "agent-1", userPromptInline: "test" },
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().enabled).toBe(true);
    });

    it("generates unique IDs for each automation", async () => {
      const res1 = await app.inject({
        method: "POST",
        url: "/api/automations",
        payload: {
          name: "Auto 1",
          trigger: { type: "cron", expression: "0 * * * *" },
          action: { type: "agent", agentId: "agent-1", userPromptInline: "test" },
        },
      });
      const res2 = await app.inject({
        method: "POST",
        url: "/api/automations",
        payload: {
          name: "Auto 2",
          trigger: { type: "cron", expression: "0 * * * *" },
          action: { type: "agent", agentId: "agent-1", userPromptInline: "test" },
        },
      });
      expect(res1.json().id).not.toBe(res2.json().id);
    });

    it("sets createdAt and updatedAt timestamps", async () => {
      const before = new Date().toISOString();
      const res = await app.inject({
        method: "POST",
        url: "/api/automations",
        payload: {
          name: "Timed",
          trigger: { type: "cron", expression: "0 * * * *" },
          action: { type: "agent", agentId: "agent-1", userPromptInline: "test" },
        },
      });
      const after = new Date().toISOString();
      const body = res.json();
      expect(body.createdAt >= before).toBe(true);
      expect(body.createdAt <= after).toBe(true);
      expect(body.updatedAt).toBe(body.createdAt);
    });
  });

  describe("PUT /api/automations/:id - edge cases", () => {
    it("rejects invalid cron expression on update", async () => {
      await saveAutomations([makeAutomation()], dataDir);
      const res = await app.inject({
        method: "PUT",
        url: "/api/automations/auto-1",
        payload: { trigger: { type: "cron", expression: "bad-cron" } },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("Invalid cron");
    });

    it("updates only the specified fields", async () => {
      await saveAutomations([makeAutomation()], dataDir);
      const res = await app.inject({
        method: "PUT",
        url: "/api/automations/auto-1",
        payload: { name: "Renamed" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.name).toBe("Renamed");
      expect(body.enabled).toBe(true); // unchanged
      expect(body.trigger.expression).toBe("0 * * * *"); // unchanged
    });

    it("updates enabled flag independently", async () => {
      await saveAutomations([makeAutomation()], dataDir);
      const res = await app.inject({
        method: "PUT",
        url: "/api/automations/auto-1",
        payload: { enabled: false },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().enabled).toBe(false);
      expect(res.json().name).toBe("Test Auto"); // unchanged
    });

    it("updates trigger expression", async () => {
      await saveAutomations([makeAutomation()], dataDir);
      const res = await app.inject({
        method: "PUT",
        url: "/api/automations/auto-1",
        payload: { trigger: { type: "cron", expression: "0 2 * * *" } },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().trigger.expression).toBe("0 2 * * *");
    });

    it("replaces the action with a new (existing) agent", async () => {
      await saveAgents([makeAgent(), makeAgent({ id: "agent-2", name: "Second" })], dataDir);
      await saveAutomations([makeAutomation()], dataDir);
      const res = await app.inject({
        method: "PUT",
        url: "/api/automations/auto-1",
        payload: { action: { type: "agent", agentId: "agent-2", userPromptInline: "Do something" } },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().action.agentId).toBe("agent-2");
      expect(res.json().action.userPromptInline).toBe("Do something");
    });

    it("rejects updating the action to a non-existent agent (400)", async () => {
      await saveAutomations([makeAutomation()], dataDir);
      const res = await app.inject({
        method: "PUT",
        url: "/api/automations/auto-1",
        payload: { action: { type: "agent", agentId: "ghost", userPromptInline: "Do something" } },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("agent not found");
    });

    it("rejects updating the action to a non-existent user prompt template (400)", async () => {
      await saveAutomations([makeAutomation()], dataDir);
      const res = await app.inject({
        method: "PUT",
        url: "/api/automations/auto-1",
        payload: { action: { type: "agent", agentId: "agent-1", userPromptId: "ghost-tpl" } },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("user prompt template not found");
    });

    it("updates notification settings", async () => {
      await saveAutomations([makeAutomation()], dataDir);
      const res = await app.inject({
        method: "PUT",
        url: "/api/automations/auto-1",
        payload: { notification: { onComplete: false, onFailure: false } },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().notification).toEqual({ onComplete: false, onFailure: false });
    });

    it("updates updatedAt timestamp", async () => {
      const auto = makeAutomation({ updatedAt: "2026-01-01T00:00:00Z" });
      await saveAutomations([auto], dataDir);

      const res = await app.inject({
        method: "PUT",
        url: "/api/automations/auto-1",
        payload: { name: "Updated" },
      });
      expect(res.json().updatedAt > "2026-01-01T00:00:00Z").toBe(true);
    });
  });

  describe("DELETE /api/automations/:id - edge cases", () => {
    it("persists deletion to disk", async () => {
      await saveAutomations([makeAutomation(), makeAutomation({ id: "auto-2", name: "Other" })], dataDir);

      const res = await app.inject({ method: "DELETE", url: "/api/automations/auto-1" });
      expect(res.statusCode).toBe(204);

      // Verify via GET
      const list = await app.inject({ method: "GET", url: "/api/automations" });
      expect(list.json()).toHaveLength(1);
      expect(list.json()[0].id).toBe("auto-2");
    });
  });

  describe("GET /api/automations/:id/runs - with data", () => {
    it("returns runs sorted newest first (as persisted)", async () => {
      const auto = makeAutomation();
      await saveAutomations([auto], dataDir);

      const runs = [
        makeRun({ id: "run-2", startedAt: "2026-01-02T00:00:00Z" }),
        makeRun({ id: "run-1", startedAt: "2026-01-01T00:00:00Z" }),
      ];
      // addRun prepends, so add oldest first
      await addRun("auto-1", runs[1], dataDir);
      await addRun("auto-1", runs[0], dataDir);

      const res = await app.inject({ method: "GET", url: "/api/automations/auto-1/runs" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(2);
      expect(res.json()[0].id).toBe("run-2"); // newest first
    });
  });

  describe("POST /api/automations/:id/trigger - edge cases", () => {
    it("returns 404 when automation does not exist", async () => {
      // Register with mock scheduler
      const mockScheduler = {
        isRunning: vi.fn(() => false),
        triggerNow: vi.fn(),
      };
      const schedulerApp = Fastify();
      await schedulerApp.register((instance) =>
        automationRoutes(instance, { dataDir, scheduler: mockScheduler as unknown as AutomationScheduler }),
      );
      await schedulerApp.ready();

      const res = await schedulerApp.inject({ method: "POST", url: "/api/automations/unknown/trigger" });
      expect(res.statusCode).toBe(404);

      await schedulerApp.close();
    });

    it("returns 409 when automation is already running", async () => {
      const mockScheduler = {
        isRunning: vi.fn(() => true),
        triggerNow: vi.fn(),
      };
      const schedulerApp = Fastify();
      await schedulerApp.register((instance) =>
        automationRoutes(instance, { dataDir, scheduler: mockScheduler as unknown as AutomationScheduler }),
      );
      await schedulerApp.ready();

      await saveAutomations([makeAutomation()], dataDir);

      const res = await schedulerApp.inject({ method: "POST", url: "/api/automations/auto-1/trigger" });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toContain("already running");

      await schedulerApp.close();
    });
  });
});

// ── Test suite WITH scheduler hooks ─────────────────────────────────

describe("Automation API - scheduler integration", () => {
  let schedulerMock: {
    onAutomationCreated: ReturnType<typeof vi.fn>;
    onAutomationUpdated: ReturnType<typeof vi.fn>;
    onAutomationDeleted: ReturnType<typeof vi.fn>;
    isRunning: ReturnType<typeof vi.fn>;
    triggerNow: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    tmpDir = await createTempDir();
    dataDir = join(tmpDir, "data");
    schedulerMock = {
      onAutomationCreated: vi.fn(async () => {}),
      onAutomationUpdated: vi.fn(async () => {}),
      onAutomationDeleted: vi.fn(async () => {}),
      isRunning: vi.fn(() => false),
      triggerNow: vi.fn(async () => makeRun()),
    };
    app = Fastify();
    await app.register((instance) =>
      automationRoutes(instance, { dataDir, scheduler: schedulerMock as unknown as AutomationScheduler }),
    );
    await app.register((instance) => promptTemplateRoutes(instance, { dataDir }));
    await app.ready();
    await saveAgents([makeAgent()], dataDir);
  });

  afterEach(async () => {
    await app.close();
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it("calls scheduler.onAutomationCreated after creating", async () => {
    await app.inject({
      method: "POST",
      url: "/api/automations",
      payload: {
        name: "New",
        trigger: { type: "cron", expression: "0 * * * *" },
        action: { type: "agent", agentId: "agent-1", userPromptInline: "test" },
      },
    });

    expect(schedulerMock.onAutomationCreated).toHaveBeenCalledTimes(1);
    const arg = schedulerMock.onAutomationCreated.mock.calls[0][0];
    expect(arg.name).toBe("New");
  });

  it("calls scheduler.onAutomationUpdated after updating", async () => {
    await saveAutomations([makeAutomation()], dataDir);

    await app.inject({
      method: "PUT",
      url: "/api/automations/auto-1",
      payload: { enabled: false },
    });

    expect(schedulerMock.onAutomationUpdated).toHaveBeenCalledTimes(1);
    const arg = schedulerMock.onAutomationUpdated.mock.calls[0][0];
    expect(arg.enabled).toBe(false);
  });

  it("calls scheduler.onAutomationDeleted after deleting", async () => {
    await saveAutomations([makeAutomation()], dataDir);

    await app.inject({ method: "DELETE", url: "/api/automations/auto-1" });

    expect(schedulerMock.onAutomationDeleted).toHaveBeenCalledWith("auto-1");
  });

  it("does not call scheduler hooks on validation failure", async () => {
    await app.inject({
      method: "POST",
      url: "/api/automations",
      payload: { name: "", trigger: { type: "cron", expression: "0 * * * *" }, action: { type: "agent", agentId: "agent-1", userPromptInline: "test" } },
    });

    expect(schedulerMock.onAutomationCreated).not.toHaveBeenCalled();
  });

  it("does not call scheduler.onAutomationUpdated on 404", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/automations/nonexistent",
      payload: { name: "X" },
    });

    expect(schedulerMock.onAutomationUpdated).not.toHaveBeenCalled();
  });

  it("does not call scheduler.onAutomationDeleted on 404", async () => {
    await app.inject({ method: "DELETE", url: "/api/automations/nonexistent" });

    expect(schedulerMock.onAutomationDeleted).not.toHaveBeenCalled();
  });

  it("trigger returns 201 with run data from scheduler", async () => {
    await saveAutomations([makeAutomation()], dataDir);

    const res = await app.inject({ method: "POST", url: "/api/automations/auto-1/trigger" });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe("run-1");
    expect(schedulerMock.triggerNow).toHaveBeenCalledWith("auto-1");
  });
});
