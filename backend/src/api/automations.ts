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
import { getDataDir, loadProject } from "../state/state.js";
import { parseGitHubRepo } from "../utils/github.js";
import type { AutomationScheduler } from "../services/automation-scheduler.js";
import type { GitHubEventPoller } from "../services/github-event-poller.js";
import type {
  Automation,
  CreateAutomationRequest,
  GitHubEventType,
  UpdateAutomationRequest,
} from "../types.js";

const KNOWN_GITHUB_EVENTS: string[] = [
  "pull_request.opened", "pull_request.synchronize", "pull_request.reopened",
  "pull_request.comment",
  "issues.opened", "issues.comment",
];

interface AutomationRoutesOptions {
  scheduler?: AutomationScheduler;
  poller?: GitHubEventPoller;
  dataDir?: string;
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
    if (!trigger?.type) {
      return reply.status(400).send({ error: "Trigger type is required" });
    }
    if (trigger.type === "github_event") {
      if (!trigger.events?.length) {
        return reply.status(400).send({ error: "At least one GitHub event type is required" });
      }
      for (const ev of trigger.events) {
        if (!KNOWN_GITHUB_EVENTS.includes(ev)) {
          return reply.status(400).send({ error: `Unknown GitHub event type: ${ev}` });
        }
      }
      if (!projectId) {
        return reply.status(400).send({ error: "projectId is required for GitHub event automations" });
      }
      const project = await loadProject(projectId, dataDir);
      if (project?.url) {
        const ghRepo = parseGitHubRepo(project.url);
        if (!ghRepo) {
          return reply.status(400).send({ error: "Project URL is not a GitHub repository" });
        }
      }
    } else if (trigger.type === "cron") {
      if (!("expression" in trigger) || !trigger.expression) {
        return reply.status(400).send({ error: "Trigger expression is required" });
      }
      // Validate cron expression
      try {
        new Cron(trigger.expression, { legacyMode: false });
      } catch {
        return reply.status(400).send({ error: "Invalid cron expression" });
      }
    } else {
      return reply.status(400).send({ error: `Unknown trigger type: ${(trigger as { type: string }).type}` });
    }
    if (!action?.modelId) {
      return reply.status(400).send({ error: "Model ID is required" });
    }
    // Validate prompt: must have either Id or Inline, not both
    if (action.systemPromptId && action.systemPromptInline) {
      return reply.status(400).send({ error: "Provide either systemPromptId or systemPromptInline, not both" });
    }
    if (action.userPromptId && action.userPromptInline) {
      return reply.status(400).send({ error: "Provide either userPromptId or userPromptInline, not both" });
    }
    // Must have at least a user prompt
    if (!action.userPromptId && !action.userPromptInline) {
      return reply.status(400).send({ error: "A user prompt is required (userPromptId or userPromptInline)" });
    }
    // Validate referenced templates exist
    if (action.systemPromptId || action.userPromptId) {
      const templates = await loadPromptTemplates(dataDir);
      if (action.systemPromptId && !templates.find((t) => t.id === action.systemPromptId)) {
        return reply.status(400).send({ error: "Referenced system prompt template not found" });
      }
      if (action.userPromptId && !templates.find((t) => t.id === action.userPromptId)) {
        return reply.status(400).send({ error: "Referenced user prompt template not found" });
      }
    }

    const now = new Date().toISOString();
    const auto: Automation = {
      id: `auto-${nanoid(8)}`,
      name: name.trim(),
      enabled: true,
      projectId: projectId || undefined,
      trigger: trigger.type === "github_event"
        ? { type: "github_event" as const, events: trigger.events as GitHubEventType[], ...(trigger.labelFilter?.length && { labelFilter: trigger.labelFilter }) }
        : { type: "cron" as const, expression: (trigger as { expression: string }).expression },
      action: {
        type: action.type ?? "agent",
        modelId: action.modelId,
        systemPromptId: action.systemPromptId,
        systemPromptInline: action.systemPromptInline,
        userPromptId: action.userPromptId,
        userPromptInline: action.userPromptInline,
        ...(action.postResultAsComment && { postResultAsComment: true }),
      },
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

      if (updates.trigger) {
        if (updates.trigger.type === "cron") {
          if (updates.trigger.expression) {
            try {
              new Cron(updates.trigger.expression, { legacyMode: false });
            } catch {
              return reply.status(400).send({ error: "Invalid cron expression" });
            }
          }
        } else if (updates.trigger.type === "github_event") {
          if (!updates.trigger.events?.length) {
            return reply.status(400).send({ error: "At least one GitHub event type is required" });
          }
          for (const ev of updates.trigger.events) {
            if (!KNOWN_GITHUB_EVENTS.includes(ev)) {
              return reply.status(400).send({ error: `Unknown GitHub event type: ${ev}` });
            }
          }
        }
      }

      const updated = await withAutomationsLock(async () => {
        const automations = await loadAutomations(dataDir);
        const idx = automations.findIndex((a) => a.id === id);
        if (idx === -1) return null;

        const auto = automations[idx];
        automations[idx] = {
          ...auto,
          ...(updates.name !== undefined && { name: updates.name.trim() }),
          ...(updates.enabled !== undefined && { enabled: updates.enabled }),
          ...(updates.trigger && { trigger: updates.trigger }),
          ...(updates.action && { action: { ...auto.action, ...updates.action } }),
          ...(updates.notification && { notification: updates.notification }),
          updatedAt: new Date().toISOString(),
        };
        await saveAutomations(automations, dataDir);
        return automations[idx];
      });

      if (!updated) return reply.status(404).send({ error: "Automation not found" });

      if (opts.scheduler) {
        await opts.scheduler.onAutomationUpdated(updated);
      }
      return updated;
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
