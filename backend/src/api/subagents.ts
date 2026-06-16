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

interface SubagentRoutesOptions {
  roots?: CustomAgentRoots;
}

function parseProvider(value: string | undefined): CustomAgentProviderId | null {
  return value === "claude" || value === "codex" ? value : null;
}

function subagentErrorMessage(err: unknown, fallback: string): string {
  return errorMessage(err, fallback)
    .replaceAll("Custom agent", "Subagent")
    .replaceAll("custom agent", "subagent");
}

export async function subagentRoutes(
  app: FastifyInstance,
  opts: SubagentRoutesOptions = {},
): Promise<void> {
  const roots = opts.roots ?? globalCustomAgentRoots();

  app.get("/api/settings/subagents", async (_req, reply) => {
    try {
      return await listGlobalCustomAgents(roots);
    } catch (err: unknown) {
      return reply
        .status(errorStatus(err))
        .send({ error: subagentErrorMessage(err, "Failed to list subagents") });
    }
  });

  app.post<{ Body: CreateCustomAgentRequest }>("/api/settings/subagents", async (req, reply) => {
    try {
      const provider = parseProvider(req.body?.provider);
      if (!provider) return reply.status(400).send({ error: "Unsupported subagent provider" });

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
        .send({ error: subagentErrorMessage(err, "Failed to create subagent") });
    }
  });

  app.get<{ Params: { id: string } }>("/api/settings/subagents/:id", async (req, reply) => {
    try {
      const agent = await loadGlobalCustomAgent(req.params.id, roots);
      if (!agent) return reply.status(404).send({ error: "Subagent not found" });
      return agent;
    } catch (err: unknown) {
      return reply
        .status(errorStatus(err))
        .send({ error: subagentErrorMessage(err, "Failed to load subagent") });
    }
  });

  app.put<{
    Params: { id: string; provider: string };
    Body: UpdateCustomAgentRequest;
  }>("/api/settings/subagents/:id/providers/:provider", async (req, reply) => {
    try {
      const provider = parseProvider(req.params.provider);
      if (!provider) return reply.status(400).send({ error: "Unsupported subagent provider" });

      const { content } = req.body ?? {};
      if (typeof content !== "string" || !content.trim()) {
        return reply.status(400).send({ error: "Content is required" });
      }

      const agent = await withCustomAgentsLock(() =>
        saveGlobalCustomAgentProvider(req.params.id, provider, content, roots),
      );
      if (!agent) return reply.status(404).send({ error: "Subagent not found" });
      return agent;
    } catch (err: unknown) {
      return reply
        .status(errorStatus(err))
        .send({ error: subagentErrorMessage(err, "Failed to save subagent") });
    }
  });

  app.delete<{ Params: { id: string; provider: string } }>(
    "/api/settings/subagents/:id/providers/:provider",
    async (req, reply) => {
      try {
        const provider = parseProvider(req.params.provider);
        if (!provider) return reply.status(400).send({ error: "Unsupported subagent provider" });

        const deleted = await withCustomAgentsLock(() =>
          deleteGlobalCustomAgentProvider(req.params.id, provider, roots),
        );
        if (!deleted) return reply.status(404).send({ error: "Subagent not found" });
        return reply.status(204).send();
      } catch (err: unknown) {
        return reply
          .status(errorStatus(err))
          .send({ error: subagentErrorMessage(err, "Failed to delete subagent") });
      }
    },
  );

  app.post<{ Params: { id: string; provider: string } }>(
    "/api/settings/subagents/:id/providers/:provider/counterpart",
    async (req, reply) => {
      try {
        const provider = parseProvider(req.params.provider);
        if (!provider) return reply.status(400).send({ error: "Unsupported subagent provider" });

        const agent = await withCustomAgentsLock(() =>
          createGlobalCustomAgentCounterpart(req.params.id, provider, roots),
        );
        if (!agent) return reply.status(404).send({ error: "Subagent not found" });
        return agent;
      } catch (err: unknown) {
        return reply
          .status(errorStatus(err))
          .send({ error: subagentErrorMessage(err, "Failed to create subagent counterpart") });
      }
    },
  );
}
