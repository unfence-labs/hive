import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { removeWorktreeAndPruneBestEffort } from "../utils/git-worktree.js";
import { bareRepoPath } from "../utils/paths.js";
import { Cron } from "croner";
import {
  loadAutomations,
  saveAutomations,
  loadRuns,
  withAutomationsLock,
} from "../state/automations.js";
import { loadPromptTemplates } from "../state/prompt-templates.js";
import { loadAgents } from "../state/agents.js";
import { getDataDir } from "../state/state.js";
import type { AutomationScheduler } from "../services/automation-scheduler.js";
import type {
  Automation,
  AutomationAction,
  CreateAutomationRequest,
  UpdateAutomationRequest,
} from "../types.js";

interface AutomationRoutesOptions {
  scheduler?: AutomationScheduler;
  dataDir?: string;
}

/**
 * Validate an automation action and return its normalized form (a whole-object
 * value with only the recognized fields). Shared by create and update so both
 * paths enforce the same agent/template existence and prompt rules. Returns an
 * error message (always a 400) instead of the normalized action on failure.
 */
async function validateAction(
  action: AutomationAction | undefined,
  dataDir: string,
): Promise<{ error: string } | { action: AutomationAction }> {
  if (!action?.agentId) {
    return { error: "An agent is required (agentId)" };
  }
  if (action.userPromptId && action.userPromptInline) {
    return { error: "Provide either userPromptId or userPromptInline, not both" };
  }
  if (!action.userPromptId && !action.userPromptInline) {
    return { error: "A user prompt is required (userPromptId or userPromptInline)" };
  }
  const agents = await loadAgents(dataDir);
  if (!agents.find((a) => a.id === action.agentId)) {
    return { error: "Referenced agent not found" };
  }
  if (action.userPromptId) {
    const templates = await loadPromptTemplates(dataDir);
    if (!templates.find((t) => t.id === action.userPromptId)) {
      return { error: "Referenced user prompt template not found" };
    }
  }
  return {
    action: {
      type: action.type ?? "agent",
      agentId: action.agentId,
      userPromptId: action.userPromptId,
      userPromptInline: action.userPromptInline,
    },
  };
}

export async function automationRoutes(
  app: FastifyInstance,
  opts: AutomationRoutesOptions = {},
): Promise<void> {
  const dataDir = opts.dataDir ?? getDataDir();

  // ── List all automations ────────────────────────────────────────────
  app.get("/api/automations", async () => {
    return loadAutomations(dataDir);
  });

  // ── Get single automation ───────────────────────────────────────────
  app.get<{ Params: { id: string } }>("/api/automations/:id", async (req, reply) => {
    const automations = await loadAutomations(dataDir);
    const auto = automations.find((a) => a.id === req.params.id);
    if (!auto) return reply.status(404).send({ error: "Automation not found" });
    return auto;
  });

  // ── Create automation ───────────────────────────────────────────────
  app.post<{ Body: CreateAutomationRequest }>("/api/automations", async (req, reply) => {
    const { name, projectId, trigger, action, notification } = req.body;

    if (!name?.trim()) {
      return reply.status(400).send({ error: "Name is required" });
    }
    if (!trigger?.expression) {
      return reply.status(400).send({ error: "Trigger expression is required" });
    }
    // Validate cron expression
    try {
      new Cron(trigger.expression, { legacyMode: false });
    } catch {
      return reply.status(400).send({ error: "Invalid cron expression" });
    }
    const actionResult = await validateAction(action, dataDir);
    if ("error" in actionResult) {
      return reply.status(400).send({ error: actionResult.error });
    }

    const now = new Date().toISOString();
    const auto: Automation = {
      id: `auto-${nanoid(8)}`,
      name: name.trim(),
      enabled: true,
      projectId: projectId || undefined,
      trigger: { type: trigger.type ?? "cron", expression: trigger.expression },
      action: actionResult.action,
      notification: {
        onComplete: notification?.onComplete ?? true,
        onFailure: notification?.onFailure ?? true,
      },
      createdAt: now,
      updatedAt: now,
    };

    await withAutomationsLock(async () => {
      const automations = await loadAutomations(dataDir);
      automations.push(auto);
      await saveAutomations(automations, dataDir);
    });

    if (opts.scheduler) {
      await opts.scheduler.onAutomationCreated(auto);
    }

    return reply.status(201).send(auto);
  });

  // ── Update automation ───────────────────────────────────────────────
  app.put<{ Params: { id: string }; Body: UpdateAutomationRequest }>(
    "/api/automations/:id",
    async (req, reply) => {
      const { id } = req.params;
      const updates = req.body;

      if (updates.trigger?.expression) {
        try {
          new Cron(updates.trigger.expression, { legacyMode: false });
        } catch {
          return reply.status(400).send({ error: "Invalid cron expression" });
        }
      }

      const result = await withAutomationsLock(async () => {
        const automations = await loadAutomations(dataDir);
        const idx = automations.findIndex((a) => a.id === id);
        if (idx === -1) return { status: 404 as const, error: "Automation not found" };

        const auto = automations[idx];

        // When the action changes, validate it the same way create does and
        // store it as a whole replacement. Clients always send a complete
        // action, so a blind merge would only carry over stale prompt fields
        // and skip the agent/template existence checks the POST path enforces.
        let nextAction = auto.action;
        if (updates.action) {
          const actionResult = await validateAction(updates.action, dataDir);
          if ("error" in actionResult) {
            return { status: 400 as const, error: actionResult.error };
          }
          nextAction = actionResult.action;
        }

        automations[idx] = {
          ...auto,
          ...(updates.name !== undefined && { name: updates.name.trim() }),
          ...(updates.enabled !== undefined && { enabled: updates.enabled }),
          ...(updates.trigger && { trigger: updates.trigger }),
          ...(updates.action && { action: nextAction }),
          ...(updates.notification && { notification: updates.notification }),
          updatedAt: new Date().toISOString(),
        };
        await saveAutomations(automations, dataDir);
        return { status: 200 as const, auto: automations[idx] };
      });

      if (result.status !== 200) {
        return reply.status(result.status).send({ error: result.error });
      }

      if (opts.scheduler) {
        await opts.scheduler.onAutomationUpdated(result.auto);
      }

      return result.auto;
    },
  );

  // ── Delete automation ───────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>("/api/automations/:id", async (req, reply) => {
    const { id } = req.params;

    const auto = await withAutomationsLock(async () => {
      const automations = await loadAutomations(dataDir);
      const idx = automations.findIndex((a) => a.id === id);
      if (idx === -1) return null;
      const deleted = automations[idx];
      automations.splice(idx, 1);
      await saveAutomations(automations, dataDir);
      return deleted;
    });

    if (!auto) return reply.status(404).send({ error: "Automation not found" });

    if (opts.scheduler) {
      await opts.scheduler.onAutomationDeleted(id);
    }

    // Clean up git worktree if project-linked
    const autoDir = join(dataDir, "automations", id);
    if (auto.projectId) {
      const bare = bareRepoPath(dataDir, auto.projectId);
      const wsPath = join(autoDir, "workspace");
      await removeWorktreeAndPruneBestEffort(bare, wsPath);
    }

    await rm(autoDir, { recursive: true, force: true }).catch(() => {});

    return reply.status(204).send();
  });

  // ── Manual trigger ──────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>("/api/automations/:id/trigger", async (req, reply) => {
    if (!opts.scheduler) {
      return reply.status(503).send({ error: "Scheduler not available" });
    }

    const automations = await loadAutomations(dataDir);
    const auto = automations.find((a) => a.id === req.params.id);
    if (!auto) return reply.status(404).send({ error: "Automation not found" });

    if (opts.scheduler.isRunning(auto.id)) {
      return reply.status(409).send({ error: "Automation is already running" });
    }

    const run = await opts.scheduler.triggerNow(auto.id);
    return reply.status(201).send(run);
  });

  // ── List runs ───────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>("/api/automations/:id/runs", async (req, reply) => {
    const automations = await loadAutomations(dataDir);
    if (!automations.find((a) => a.id === req.params.id)) {
      return reply.status(404).send({ error: "Automation not found" });
    }
    return loadRuns(req.params.id, dataDir);
  });

  // ── Get run messages ──────────────────────────────────────────────
  app.get<{ Params: { id: string; runId: string } }>(
    "/api/automations/:id/runs/:runId/messages",
    async (req, reply) => {
      const { id, runId } = req.params;

      const automations = await loadAutomations(dataDir);
      if (!automations.find((a) => a.id === id)) {
        return reply.status(404).send({ error: "Automation not found" });
      }

      const runs = await loadRuns(id, dataDir);
      const run = runs.find((r) => r.id === runId);
      if (!run) {
        return reply.status(404).send({ error: "Run not found" });
      }

      const sessDir = join(dataDir, "automations", id, "sessions", run.sessionId);

      let messages: unknown[] = [];
      try {
        const raw = await readFile(join(sessDir, "messages.jsonl"), "utf-8");
        messages = raw
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line));
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }

      let systemPrompt: string | undefined;
      try {
        systemPrompt = await readFile(join(sessDir, "system-prompt.txt"), "utf-8");
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }

      return { messages, systemPrompt };
    },
  );
}
