import type { FastifyInstance } from "fastify";
import {
  launchAgent,
  stopAgent,
  getAgent,
  listAgents,
  launchConversation,
  getConversation,
  endConversation,
  type LaunchOptions,
  type ConversationOptions,
} from "../agents/agent-manager.js";
import type { CreateAgentRequest, CreateConversationRequest } from "../types.js";

export interface AgentRoutesOptions {
  dataDir?: string;
  launchOptions?: LaunchOptions;
  conversationOptions?: ConversationOptions;
}

export async function agentRoutes(app: FastifyInstance, opts: AgentRoutesOptions = {}) {
  const { dataDir, launchOptions, conversationOptions } = opts;

  // ── Print-mode agent routes (existing) ─────────────────────────────

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

  // ── Conversation routes ────────────────────────────────────────────

  app.post<{ Params: { wsId: string }; Body: CreateConversationRequest }>(
    "/api/workspaces/:wsId/conversation",
    async (req, reply) => {
      const { sessionId } = req.body ?? {};

      try {
        const state = await launchConversation(
          req.params.wsId,
          dataDir,
          conversationOptions,
          sessionId,
        );
        return reply.status(201).send(state);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to start conversation";
        const code = msg.includes("busy") ? 409 : msg.includes("not found") ? 404 : 500;
        return reply.status(code).send({ error: msg });
      }
    }
  );

  app.get<{ Params: { wsId: string } }>(
    "/api/workspaces/:wsId/conversation",
    async (req, reply) => {
      const session = getConversation(req.params.wsId);
      if (!session) {
        return reply.status(404).send({ error: "No active conversation" });
      }
      return reply.send({
        sessionId: session.sessionId,
        status: session.status,
        messages: [],
      });
    }
  );

  app.get<{ Params: { wsId: string } }>(
    "/api/workspaces/:wsId/conversation/messages",
    async (req, reply) => {
      const session = getConversation(req.params.wsId);
      if (!session) {
        return reply.status(404).send({ error: "No active conversation" });
      }
      // Messages are tracked client-side via WebSocket; REST returns empty for now.
      // A future enhancement could persist messages in the session.
      return reply.send([]);
    }
  );

  app.delete<{ Params: { wsId: string } }>(
    "/api/workspaces/:wsId/conversation",
    async (req, reply) => {
      try {
        await endConversation(req.params.wsId, dataDir);
        return reply.status(204).send();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to end conversation";
        const code = msg.includes("No conversation") ? 404 : 500;
        return reply.status(code).send({ error: msg });
      }
    }
  );
}
