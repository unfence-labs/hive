import type { FastifyInstance } from "fastify";
import {
  deleteGlobalInstructions,
  globalInstructionRoots,
  loadGlobalInstructions,
  saveGlobalInstructions,
  syncGlobalInstructions,
  withInstructionsLock,
  type InstructionRoots,
} from "../state/agent-instructions.js";
import type { UpdateInstructionsRequest } from "../types.js";
import { errorMessage, errorStatus } from "../utils/errors.js";

interface InstructionRoutesOptions {
  roots?: InstructionRoots;
}

export async function instructionRoutes(
  app: FastifyInstance,
  opts: InstructionRoutesOptions = {},
): Promise<void> {
  const roots = opts.roots ?? globalInstructionRoots();

  app.get("/api/settings/instructions", async (_req, reply) => {
    try {
      return await loadGlobalInstructions(roots);
    } catch (err: unknown) {
      return reply
        .status(errorStatus(err))
        .send({ error: errorMessage(err, "Failed to load instructions") });
    }
  });

  app.put<{ Body: UpdateInstructionsRequest }>("/api/settings/instructions", async (req, reply) => {
    try {
      const { content } = req.body ?? {};
      if (typeof content !== "string" || !content.trim()) {
        return reply.status(400).send({ error: "Content is required" });
      }

      return await withInstructionsLock(() => saveGlobalInstructions(content, roots));
    } catch (err: unknown) {
      return reply
        .status(errorStatus(err))
        .send({ error: errorMessage(err, "Failed to save instructions") });
    }
  });

  app.post("/api/settings/instructions/sync", async (_req, reply) => {
    try {
      return await withInstructionsLock(() => syncGlobalInstructions(roots));
    } catch (err: unknown) {
      return reply
        .status(errorStatus(err))
        .send({ error: errorMessage(err, "Failed to sync instructions") });
    }
  });

  app.delete("/api/settings/instructions", async (_req, reply) => {
    try {
      const deleted = await withInstructionsLock(() => deleteGlobalInstructions(roots));
      if (!deleted) return reply.status(404).send({ error: "Instructions not found" });
      return reply.status(204).send();
    } catch (err: unknown) {
      return reply
        .status(errorStatus(err))
        .send({ error: errorMessage(err, "Failed to delete instructions") });
    }
  });
}
