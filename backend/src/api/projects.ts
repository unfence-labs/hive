import type { FastifyInstance } from "fastify";
import {
  createProject,
  listProjects,
  getProject,
  deleteProject,
  fetchProject,
} from "../projects/project-manager.js";
import { errorMessage, errorStatus } from "../utils/errors.js";
import { bareRepoPath, workspacesDir } from "../utils/paths.js";
import { getDataDir } from "../state/state.js";
import type { CreateProjectRequest, ProjectState } from "../types.js";

function enrichProject(project: ProjectState, dir: string) {
  return {
    ...project,
    repoPath: bareRepoPath(dir, project.id),
    workspacesPath: workspacesDir(dir, project.id),
  };
}

export async function projectRoutes(app: FastifyInstance, dataDir?: string) {
  app.post<{ Body: CreateProjectRequest }>("/api/projects", async (req, reply) => {
    const { url } = req.body ?? {};
    if (!url) return reply.status(400).send({ error: "url is required" });

    try {
      const project = await createProject(url, dataDir);
      return reply.status(201).send(project);
    } catch (err: unknown) {
      return reply
        .status(errorStatus(err, 400))
        .send({ error: errorMessage(err, "Clone failed") });
    }
  });

  app.get("/api/projects", async (_req, reply) => {
    const dir = dataDir ?? getDataDir();
    const projects = await listProjects(dir);
    return reply.send(projects.map((p) => enrichProject(p, dir)));
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id", async (req, reply) => {
    const dir = dataDir ?? getDataDir();
    const project = await getProject(req.params.id, dir);
    if (!project) return reply.status(404).send({ error: "Project not found" });
    return reply.send(enrichProject(project, dir));
  });

  app.delete<{ Params: { id: string } }>("/api/projects/:id", async (req, reply) => {
    const project = await getProject(req.params.id, dataDir);
    if (!project) return reply.status(404).send({ error: "Project not found" });
    if (project.workspaces.length > 0) {
      return reply.status(409).send({ error: "Cannot delete project with active workspaces" });
    }
    await deleteProject(req.params.id, dataDir);
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>("/api/projects/:id/fetch", async (req, reply) => {
    try {
      await fetchProject(req.params.id, dataDir);
      return reply.send({ status: "ok" });
    } catch (err: unknown) {
      return reply
        .status(errorStatus(err))
        .send({ error: errorMessage(err, "Fetch failed") });
    }
  });
}
