import type { FastifyInstance } from "fastify";
import {
  createGlobalSkill,
  deleteGlobalSkill,
  globalSkillRoots,
  listGlobalSkills,
  loadGlobalSkill,
  saveGlobalSkill,
  syncGlobalSkill,
  syncMissingGlobalSkills,
  withSkillsLock,
  type SkillRoots,
} from "../state/skills.js";
import type { CreateSkillRequest, UpdateSkillRequest } from "../types.js";
import { errorMessage, errorStatus } from "../utils/errors.js";

interface SkillRoutesOptions {
  roots?: SkillRoots;
}

export async function skillRoutes(
  app: FastifyInstance,
  opts: SkillRoutesOptions = {},
): Promise<void> {
  const roots = opts.roots ?? globalSkillRoots();

  app.get("/api/settings/skills", async (_req, reply) => {
    try {
      return await listGlobalSkills(roots);
    } catch (err: unknown) {
      return reply
        .status(errorStatus(err))
        .send({ error: errorMessage(err, "Failed to list skills") });
    }
  });

  app.post<{ Body: CreateSkillRequest }>("/api/settings/skills", async (req, reply) => {
    try {
      const { content } = req.body ?? {};
      if (typeof content !== "string" || !content.trim()) {
        return reply.status(400).send({ error: "Content is required" });
      }

      const skill = await withSkillsLock(() => createGlobalSkill(content, roots));
      return reply.status(201).send(skill);
    } catch (err: unknown) {
      return reply
        .status(errorStatus(err))
        .send({ error: errorMessage(err, "Failed to create skill") });
    }
  });

  app.get<{ Params: { id: string } }>("/api/settings/skills/:id", async (req, reply) => {
    try {
      const skill = await loadGlobalSkill(req.params.id, roots);
      if (!skill) return reply.status(404).send({ error: "Skill not found" });
      return skill;
    } catch (err: unknown) {
      return reply
        .status(errorStatus(err))
        .send({ error: errorMessage(err, "Failed to load skill") });
    }
  });

  app.put<{ Params: { id: string }; Body: UpdateSkillRequest }>(
    "/api/settings/skills/:id",
    async (req, reply) => {
      try {
        const { content } = req.body ?? {};
        if (typeof content !== "string" || !content.trim()) {
          return reply.status(400).send({ error: "Content is required" });
        }

        const skill = await withSkillsLock(() => saveGlobalSkill(req.params.id, content, roots));
        if (!skill) return reply.status(404).send({ error: "Skill not found" });
        return skill;
      } catch (err: unknown) {
        return reply
          .status(errorStatus(err))
          .send({ error: errorMessage(err, "Failed to save skill") });
      }
    },
  );

  app.delete<{ Params: { id: string } }>("/api/settings/skills/:id", async (req, reply) => {
    try {
      const deleted = await withSkillsLock(() => deleteGlobalSkill(req.params.id, roots));
      if (!deleted) return reply.status(404).send({ error: "Skill not found" });
      return reply.status(204).send();
    } catch (err: unknown) {
      return reply
        .status(errorStatus(err))
        .send({ error: errorMessage(err, "Failed to delete skill") });
    }
  });

  app.post<{ Params: { id: string } }>("/api/settings/skills/:id/sync", async (req, reply) => {
    try {
      const skill = await withSkillsLock(() => syncGlobalSkill(req.params.id, roots));
      if (!skill) return reply.status(404).send({ error: "Skill not found" });
      return skill;
    } catch (err: unknown) {
      return reply
        .status(errorStatus(err))
        .send({ error: errorMessage(err, "Failed to sync skill") });
    }
  });

  app.post("/api/settings/skills/sync-missing", async (_req, reply) => {
    try {
      return await withSkillsLock(() => syncMissingGlobalSkills(roots));
    } catch (err: unknown) {
      return reply
        .status(errorStatus(err))
        .send({ error: errorMessage(err, "Failed to sync skills") });
    }
  });
}
