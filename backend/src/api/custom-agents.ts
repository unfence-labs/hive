import type { FastifyInstance } from "fastify";
import {
  createGlobalCustomAgent,
  createGlobalCustomAgentCounterpart,
  deleteGlobalCustomAgentProvider,
  globalCustomAgentRoots,
  listGlobalCustomAgents,
  loadGlobalCustomAgent,
  saveGlobalCustomAgentProvider,
  withCustomAgentsLock,
  type CustomAgentRoots,
} from "../state/custom-agents.js";
import type {
  CreateCustomAgentRequest,
  CustomAgentProviderId,
  UpdateCustomAgentRequest,
} from "../types.js";
import { errorMessage, errorStatus } from "../utils/errors.js";

interface CustomAgentRoutesOptions {
  roots?: CustomAgentRoots;
}

function parseProvider(value: string | undefined): CustomAgentProviderId | null {
  return value === "claude" || value === "codex" ? value : null;
}

export async function customAgentRoutes(
  app: FastifyInstance,
  opts: CustomAgentRoutesOptions = {},
): Promise<void> {
  const roots = opts.roots ?? globalCustomAgentRoots();

  app.get("/api/settings/custom-agents", async (_req, reply) => {
    try {
      return await listGlobalCustomAgents(roots);
    } catch (err: unknown) {
      return reply
        .status(errorStatus(err))
        .send({ error: errorMessage(err, "Failed to list custom agents") });
    }
  });

  app.post<{ Body: CreateCustomAgentRequest }>("/api/settings/custom-agents", async (req, reply) => {
    try {
      const provider = parseProvider(req.body?.provider);
      if (!provider) return reply.status(400).send({ error: "Unsupported custom agent provider" });

      const { content } = req.body ?? {};
      if (typeof content !== "string" || !content.trim()) {
        return reply.status(400).send({ error: "Content is required" });
      }

      const agent = await withCustomAgentsLock(() =>
        createGlobalCustomAgent(provider, content, roots),
      );
      return reply.status(201).send(agent);
    } catch (err: unknown) {
      return reply
        .status(errorStatus(err))
        .send({ error: errorMessage(err, "Failed to create custom agent") });
    }
  });

  app.get<{ Params: { id: string } }>("/api/settings/custom-agents/:id", async (req, reply) => {
    try {
      const agent = await loadGlobalCustomAgent(req.params.id, roots);
      if (!agent) return reply.status(404).send({ error: "Custom agent not found" });
      return agent;
    } catch (err: unknown) {
      return reply
        .status(errorStatus(err))
        .send({ error: errorMessage(err, "Failed to load custom agent") });
    }
  });

  app.put<{
    Params: { id: string; provider: string };
    Body: UpdateCustomAgentRequest;
  }>("/api/settings/custom-agents/:id/providers/:provider", async (req, reply) => {
    try {
      const provider = parseProvider(req.params.provider);
      if (!provider) return reply.status(400).send({ error: "Unsupported custom agent provider" });

      const { content } = req.body ?? {};
      if (typeof content !== "string" || !content.trim()) {
        return reply.status(400).send({ error: "Content is required" });
      }

      const agent = await withCustomAgentsLock(() =>
        saveGlobalCustomAgentProvider(req.params.id, provider, content, roots),
      );
      if (!agent) return reply.status(404).send({ error: "Custom agent not found" });
      return agent;
    } catch (err: unknown) {
      return reply
        .status(errorStatus(err))
        .send({ error: errorMessage(err, "Failed to save custom agent") });
    }
  });

  app.delete<{ Params: { id: string; provider: string } }>(
    "/api/settings/custom-agents/:id/providers/:provider",
    async (req, reply) => {
      try {
        const provider = parseProvider(req.params.provider);
        if (!provider) return reply.status(400).send({ error: "Unsupported custom agent provider" });

        const deleted = await withCustomAgentsLock(() =>
          deleteGlobalCustomAgentProvider(req.params.id, provider, roots),
        );
        if (!deleted) return reply.status(404).send({ error: "Custom agent not found" });
        return reply.status(204).send();
      } catch (err: unknown) {
        return reply
          .status(errorStatus(err))
          .send({ error: errorMessage(err, "Failed to delete custom agent") });
      }
    },
  );

  app.post<{ Params: { id: string; provider: string } }>(
    "/api/settings/custom-agents/:id/providers/:provider/counterpart",
    async (req, reply) => {
      try {
        const provider = parseProvider(req.params.provider);
        if (!provider) return reply.status(400).send({ error: "Unsupported custom agent provider" });

        const agent = await withCustomAgentsLock(() =>
          createGlobalCustomAgentCounterpart(req.params.id, provider, roots),
        );
        if (!agent) return reply.status(404).send({ error: "Custom agent not found" });
        return agent;
      } catch (err: unknown) {
        return reply
          .status(errorStatus(err))
          .send({ error: errorMessage(err, "Failed to create custom agent counterpart") });
      }
    },
  );
}
