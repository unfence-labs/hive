import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { loadAgents, saveAgents, withAgentsLock } from "../state/agents.js";
import { loadAutomations } from "../state/automations.js";
import { getDataDir } from "../state/state.js";
import {
  getDefaultThinkingLevelForModel,
  isKnownModelId,
  isThinkingLevelSupportedForModel,
} from "../agents/providers/registry.js";
import type { Agent, CreateAgentRequest, ThinkingLevel, UpdateAgentRequest } from "../types.js";

interface AgentRoutesOptions {
  dataDir?: string;
}

function resolveThinkingLevel(
  modelId: string,
  requested: ThinkingLevel | undefined,
): { thinkingLevel?: ThinkingLevel } | { error: string } {
  if (requested !== undefined) {
    if (!isThinkingLevelSupportedForModel(modelId, requested)) {
      return { error: `Thinking level "${requested}" is not supported by model ${modelId}` };
    }
    return { thinkingLevel: requested };
  }

  // Undefined for models with no thinking-level control (e.g. Kimi): the
  // agent is stored without a level and no effort flag is ever emitted.
  return { thinkingLevel: getDefaultThinkingLevelForModel(modelId) };
}

export async function agentRoutes(
  app: FastifyInstance,
  opts: AgentRoutesOptions = {},
): Promise<void> {
  const dataDir = opts.dataDir ?? getDataDir();

  // ── List all agents ─────────────────────────────────────────────────
  app.get("/api/agents", async () => {
    return loadAgents(dataDir);
  });

  // ── Create agent ────────────────────────────────────────────────────
  app.post<{ Body: CreateAgentRequest }>("/api/agents", async (req, reply) => {
    const {
      name,
      description,
      systemPrompt,
      modelId,
      thinkingLevel,
      readOnly,
    } = req.body;

    if (!name?.trim()) {
      return reply.status(400).send({ error: "Name is required" });
    }
    if (!systemPrompt?.trim()) {
      return reply.status(400).send({ error: "System prompt is required" });
    }
    if (!modelId?.trim()) {
      return reply.status(400).send({ error: "Model is required" });
    }
    if (!isKnownModelId(modelId.trim())) {
      return reply.status(400).send({ error: `Unknown model: ${modelId.trim()}` });
    }
    const thinkingResult = resolveThinkingLevel(modelId.trim(), thinkingLevel);
    if ("error" in thinkingResult) {
      return reply.status(400).send({ error: thinkingResult.error });
    }

    const now = new Date().toISOString();
    const agent: Agent = {
      id: `agent-${nanoid(8)}`,
      name: name.trim(),
      ...(description?.trim() && { description: description.trim() }),
      systemPrompt: systemPrompt.trim(),
      modelId: modelId.trim(),
      ...(thinkingResult.thinkingLevel && { thinkingLevel: thinkingResult.thinkingLevel }),
      readOnly: readOnly ?? false,
      createdAt: now,
      updatedAt: now,
    };

    await withAgentsLock(async () => {
      const agents = await loadAgents(dataDir);
      agents.push(agent);
      await saveAgents(agents, dataDir);
    });

    return reply.status(201).send(agent);
  });

  // ── Update agent ────────────────────────────────────────────────────
  app.patch<{ Params: { id: string }; Body: UpdateAgentRequest }>(
    "/api/agents/:id",
    async (req, reply) => {
      const { id } = req.params;
      const updates = req.body;

      // Required fields, when provided, must not be blanked out — mirrors the
      // create-time validation so an edit cannot leave an agent without a name,
      // system prompt, or model.
      if (updates.name !== undefined && !updates.name.trim()) {
        return reply.status(400).send({ error: "Name cannot be empty" });
      }
      if (updates.systemPrompt !== undefined && !updates.systemPrompt.trim()) {
        return reply.status(400).send({ error: "System prompt cannot be empty" });
      }
      if (updates.modelId !== undefined && !updates.modelId.trim()) {
        return reply.status(400).send({ error: "Model cannot be empty" });
      }
      if (updates.modelId !== undefined && !isKnownModelId(updates.modelId.trim())) {
        return reply.status(400).send({ error: `Unknown model: ${updates.modelId.trim()}` });
      }

      const result = await withAgentsLock(async () => {
        const agents = await loadAgents(dataDir);
        const idx = agents.findIndex((a) => a.id === id);
        if (idx === -1) return { status: 404 as const, error: "Agent not found" };

        const current = agents[idx];
        const nextModelId = updates.modelId !== undefined
          ? updates.modelId.trim()
          : current.modelId;
        let nextThinkingLevel = current.thinkingLevel;
        if (updates.thinkingLevel !== undefined) {
          const thinkingResult = resolveThinkingLevel(nextModelId, updates.thinkingLevel);
          if ("error" in thinkingResult) {
            return { status: 400 as const, error: thinkingResult.error };
          }
          nextThinkingLevel = thinkingResult.thinkingLevel;
        } else if (
          updates.modelId !== undefined &&
          (nextThinkingLevel === undefined || !isThinkingLevelSupportedForModel(nextModelId, nextThinkingLevel))
        ) {
          // Model changed and the stored level no longer applies: fall back to
          // the new model's default (undefined for level-less models).
          nextThinkingLevel = getDefaultThinkingLevelForModel(nextModelId);
        }

        const merged: Agent = {
          ...current,
          ...(updates.name !== undefined && { name: updates.name.trim() }),
          ...(updates.description !== undefined && { description: updates.description.trim() }),
          ...(updates.systemPrompt !== undefined && { systemPrompt: updates.systemPrompt.trim() }),
          modelId: nextModelId,
          thinkingLevel: nextThinkingLevel,
          ...(updates.readOnly !== undefined && { readOnly: updates.readOnly }),
          updatedAt: new Date().toISOString(),
        };
        agents[idx] = merged;
        await saveAgents(agents, dataDir);
        return { status: 200 as const, agent: merged };
      });

      if (result.status !== 200) {
        return reply.status(result.status).send({ error: result.error });
      }
      return result.agent;
    },
  );

  // ── Delete agent ────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>("/api/agents/:id", async (req, reply) => {
    const { id } = req.params;

    // Check if any automation references this agent
    const automations = await loadAutomations(dataDir);
    const referencedBy = automations.find((a) => a.action.agentId === id);
    if (referencedBy) {
      return reply.status(409).send({
        error: `Agent is referenced by automation "${referencedBy.name}"`,
      });
    }

    const found = await withAgentsLock(async () => {
      const agents = await loadAgents(dataDir);
      const idx = agents.findIndex((a) => a.id === id);
      if (idx === -1) return false;
      agents.splice(idx, 1);
      await saveAgents(agents, dataDir);
      return true;
    });

    if (!found) return reply.status(404).send({ error: "Agent not found" });
    return reply.status(204).send();
  });
}
