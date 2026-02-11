import type { FastifyInstance } from "fastify";
import {
  createWorkspace,
  listWorkspaces,
  getWorkspace,
  deleteWorkspace,
  getWorkspaceDiff,
  mergeWorkspace,
} from "../workspaces/workspace-manager.js";
import { errorMessage } from "../utils/errors.js";

export async function workspaceRoutes(app: FastifyInstance, dataDir?: string) {
  app.post<{ Params: { id: string } }>("/api/projects/:id/workspaces", async (req, reply) => {
    try {
      const workspace = await createWorkspace(req.params.id, dataDir);
      return reply.status(201).send(workspace);
    } catch (err: unknown) {
      return reply.status(404).send({ error: errorMessage(err, "Failed to create workspace") });
    }
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id/workspaces", async (req, reply) => {
    try {
      const workspaces = await listWorkspaces(req.params.id, dataDir);
      return reply.send(workspaces);
    } catch (err: unknown) {
      return reply.status(404).send({ error: errorMessage(err, "Failed") });
    }
  });

  app.get<{ Params: { wsId: string } }>("/api/workspaces/:wsId", async (req, reply) => {
    const result = await getWorkspace(req.params.wsId, dataDir);
    if (!result) return reply.status(404).send({ error: "Workspace not found" });
    return reply.send(result.workspace);
  });

  app.delete<{ Params: { wsId: string } }>("/api/workspaces/:wsId", async (req, reply) => {
    try {
      await deleteWorkspace(req.params.wsId, dataDir);
      return reply.status(204).send();
    } catch (err: unknown) {
      return reply.status(404).send({ error: errorMessage(err, "Failed") });
    }
  });

  app.get<{ Params: { wsId: string } }>("/api/workspaces/:wsId/diff", async (req, reply) => {
    try {
      const diff = await getWorkspaceDiff(req.params.wsId, dataDir);
      return reply.send({ diff });
    } catch (err: unknown) {
      return reply.status(404).send({ error: errorMessage(err, "Failed") });
    }
  });

  app.post<{ Params: { wsId: string } }>("/api/workspaces/:wsId/merge", async (req, reply) => {
    try {
      await mergeWorkspace(req.params.wsId, dataDir);
      return reply.send({ status: "merged" });
    } catch (err: unknown) {
      const msg = errorMessage(err, "Merge failed");
      const code = msg.includes("not found") ? 404 : 409;
      return reply.status(code).send({ error: msg });
    }
  });
}
