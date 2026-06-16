import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { loadAgents, saveAgents, withAgentsLock } from "../state/agents.js";
import { loadAutomations } from "../state/automations.js";
import { getDataDir } from "../state/state.js";
import type { Agent, CreateAgentRequest, UpdateAgentRequest } from "../types.js";

interface AgentRoutesOptions {
  dataDir?: string;
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
    const { name, description, systemPrompt, modelId, injectGitContext, readOnly } = req.body;

    if (!name?.trim()) {
      return reply.status(400).send({ error: "Name is required" });
    }
    if (!systemPrompt?.trim()) {
      return reply.status(400).send({ error: "System prompt is required" });
    }
    if (!modelId?.trim()) {
      return reply.status(400).send({ error: "Model is required" });
    }

    const now = new Date().toISOString();
    const agent: Agent = {
      id: `agent-${nanoid(8)}`,
      name: name.trim(),
      ...(description?.trim() && { description: description.trim() }),
      systemPrompt: systemPrompt.trim(),
      modelId: modelId.trim(),
      injectGitContext: injectGitContext ?? true,
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

      const updated = await withAgentsLock(async () => {
        const agents = await loadAgents(dataDir);
        const idx = agents.findIndex((a) => a.id === id);
        if (idx === -1) return null;

        const merged: Agent = {
          ...agents[idx],
          ...(updates.name !== undefined && { name: updates.name.trim() }),
          ...(updates.description !== undefined && { description: updates.description.trim() }),
          ...(updates.systemPrompt !== undefined && { systemPrompt: updates.systemPrompt.trim() }),
          ...(updates.modelId !== undefined && { modelId: updates.modelId.trim() }),
          ...(updates.injectGitContext !== undefined && {
            injectGitContext: updates.injectGitContext,
          }),
          ...(updates.readOnly !== undefined && { readOnly: updates.readOnly }),
          updatedAt: new Date().toISOString(),
        };
        agents[idx] = merged;
        await saveAgents(agents, dataDir);
        return merged;
      });

      if (!updated) return reply.status(404).send({ error: "Agent not found" });
      return updated;
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
