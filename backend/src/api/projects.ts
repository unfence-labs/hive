import type { FastifyInstance } from "fastify";
import {
  createProject,
  listProjects,
  getProject,
  deleteProject,
  fetchProject,
} from "../projects/project-manager.js";
import type { CreateProjectRequest } from "../types.js";

export async function projectRoutes(app: FastifyInstance, dataDir?: string) {
  app.post<{ Body: CreateProjectRequest }>("/api/projects", async (req, reply) => {
    const { url } = req.body ?? {};
    if (!url) return reply.status(400).send({ error: "url is required" });

    try {
      const project = await createProject(url, dataDir);
      return reply.status(201).send(project);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Clone failed";
      return reply.status(400).send({ error: msg });
    }
  });

  app.get("/api/projects", async (_req, reply) => {
    const projects = await listProjects(dataDir);
    return reply.send(projects);
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id", async (req, reply) => {
    const project = await getProject(req.params.id, dataDir);
    if (!project) return reply.status(404).send({ error: "Project not found" });
    return reply.send(project);
  });

  app.delete<{ Params: { id: string } }>("/api/projects/:id", async (req, reply) => {
    const project = await getProject(req.params.id, dataDir);
    if (!project) return reply.status(404).send({ error: "Project not found" });
    await deleteProject(req.params.id, dataDir);
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>("/api/projects/:id/fetch", async (req, reply) => {
    try {
      await fetchProject(req.params.id, dataDir);
      return reply.send({ status: "ok" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Fetch failed";
      return reply.status(404).send({ error: msg });
    }
  });
}
