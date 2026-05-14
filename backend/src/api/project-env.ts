import type { FastifyInstance } from "fastify";
import { getProject } from "../projects/project-manager.js";
import { loadProjectEnv, saveProjectEnv, deleteProjectEnv } from "../state/project-env.js";
import { getDataDir } from "../state/state.js";
import { errorMessage, errorStatus } from "../utils/errors.js";
import { parseProjectEnvConfig } from "@hive/shared/project-env";

async function ensureProject(projectId: string, dataDir: string): Promise<boolean> {
  return (await getProject(projectId, dataDir)) !== null;
}

export async function projectEnvRoutes(app: FastifyInstance, dataDir?: string) {
  const dir = dataDir ?? getDataDir();

  app.get<{ Params: { id: string } }>("/api/projects/:id/env", async (req, reply) => {
    try {
      if (!(await ensureProject(req.params.id, dir))) {
        return reply.status(404).send({ error: "Project not found" });
      }
      return reply.send(await loadProjectEnv(req.params.id, dir));
    } catch (err: unknown) {
      return reply.status(errorStatus(err)).send({ error: errorMessage(err, "Failed to load environment") });
    }
  });

  app.put<{ Params: { id: string }; Body: { config?: unknown } }>(
    "/api/projects/:id/env",
    async (req, reply) => {
      try {
        if (!(await ensureProject(req.params.id, dir))) {
          return reply.status(404).send({ error: "Project not found" });
        }
        const { config: rawConfig } = req.body ?? {};
        const config = parseProjectEnvConfig(rawConfig);
        if (!config) {
          return reply.status(400).send({ error: "Config is required" });
        }
        return reply.send(await saveProjectEnv(req.params.id, config, dir));
      } catch (err: unknown) {
        return reply.status(errorStatus(err, 400)).send({ error: errorMessage(err, "Failed to save environment") });
      }
    },
  );

  app.delete<{ Params: { id: string } }>("/api/projects/:id/env", async (req, reply) => {
    try {
      if (!(await ensureProject(req.params.id, dir))) {
        return reply.status(404).send({ error: "Project not found" });
      }
      await deleteProjectEnv(req.params.id, dir);
      return reply.status(204).send();
    } catch (err: unknown) {
      return reply.status(errorStatus(err)).send({ error: errorMessage(err, "Failed to delete environment") });
    }
  });
}
