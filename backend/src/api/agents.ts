import type { FastifyInstance } from "fastify";
import {
  launchAgent,
  stopAgent,
  getAgent,
  listAgents,
  type LaunchOptions,
} from "../agents/agent-manager.js";
import type { CreateAgentRequest } from "../types.js";

export interface AgentRoutesOptions {
  dataDir?: string;
  launchOptions?: LaunchOptions;
}

export async function agentRoutes(app: FastifyInstance, opts: AgentRoutesOptions = {}) {
  const { dataDir, launchOptions } = opts;

  app.post<{ Params: { wsId: string }; Body: CreateAgentRequest }>(
    "/api/workspaces/:wsId/agents",
    async (req, reply) => {
      const { prompt } = req.body ?? {};
      if (!prompt) return reply.status(400).send({ error: "prompt is required" });

      try {
        const agent = await launchAgent(req.params.wsId, prompt, dataDir, launchOptions);
        return reply.status(201).send(agent);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to launch agent";
        const code = msg.includes("busy") ? 409 : msg.includes("not found") ? 404 : 500;
        return reply.status(code).send({ error: msg });
      }
    }
  );

  app.get<{ Params: { wsId: string } }>("/api/workspaces/:wsId/agents", async (req, reply) => {
    try {
      const agents = await listAgents(req.params.wsId, dataDir);
      return reply.send(agents);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed";
      return reply.status(404).send({ error: msg });
    }
  });

  app.get<{ Params: { agentId: string } }>("/api/agents/:agentId", async (req, reply) => {
    const agent = await getAgent(req.params.agentId, dataDir);
    if (!agent) return reply.status(404).send({ error: "Agent not found" });
    return reply.send(agent);
  });

  app.delete<{ Params: { agentId: string } }>("/api/agents/:agentId", async (req, reply) => {
    try {
      await stopAgent(req.params.agentId);
      return reply.status(204).send();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed";
      return reply.status(404).send({ error: msg });
    }
  });
}
