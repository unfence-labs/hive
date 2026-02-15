import type { FastifyInstance } from "fastify";
import {
  createWorkspace,
  listWorkspaces,
  getWorkspace,
  deleteWorkspace,
  getWorkspaceDiff,
  getWorkspaceDiffStat,
  listWorkspaceFiles,
  getWorkspaceFileContent,
  mergeWorkspace,
} from "../workspaces/workspace-manager.js";
import { bareRepoPath, resolveDefaultBranch } from "../utils/paths.js";
import { getDataDir } from "../state/state.js";
import { errorMessage, errorStatus } from "../utils/errors.js";

export async function workspaceRoutes(app: FastifyInstance, dataDir?: string) {
  app.post<{ Params: { id: string } }>("/api/projects/:id/workspaces", async (req, reply) => {
    try {
      const workspace = await createWorkspace(req.params.id, dataDir);
      return reply.status(201).send(workspace);
    } catch (err: unknown) {
      return reply
        .status(errorStatus(err))
        .send({ error: errorMessage(err, "Failed to create workspace") });
    }
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id/workspaces", async (req, reply) => {
    try {
      const workspaces = await listWorkspaces(req.params.id, dataDir);
      return reply.send(workspaces);
    } catch (err: unknown) {
      return reply.status(errorStatus(err)).send({ error: errorMessage(err, "Failed") });
    }
  });

  app.get<{ Params: { wsId: string } }>("/api/workspaces/:wsId", async (req, reply) => {
    const result = await getWorkspace(req.params.wsId, dataDir);
    if (!result) return reply.status(404).send({ error: "Workspace not found" });

    const bare = bareRepoPath(dataDir ?? getDataDir(), result.projectState.id);
    const defaultBranch = await resolveDefaultBranch(bare);

    return reply.send({
      ...result.workspace,
      projectName: result.projectState.name,
      defaultBranch,
    });
  });

  app.delete<{ Params: { wsId: string } }>("/api/workspaces/:wsId", async (req, reply) => {
    try {
      await deleteWorkspace(req.params.wsId, dataDir);
      return reply.status(204).send();
    } catch (err: unknown) {
      return reply.status(errorStatus(err)).send({ error: errorMessage(err, "Failed") });
    }
  });

  app.get<{ Params: { wsId: string } }>("/api/workspaces/:wsId/diff", async (req, reply) => {
    try {
      const diff = await getWorkspaceDiff(req.params.wsId, dataDir);
      return reply.send({ diff });
    } catch (err: unknown) {
      return reply.status(errorStatus(err)).send({ error: errorMessage(err, "Failed") });
    }
  });

  app.get<{ Params: { wsId: string } }>("/api/workspaces/:wsId/diff/stat", async (req, reply) => {
    try {
      const stats = await getWorkspaceDiffStat(req.params.wsId, dataDir);
      return reply.send(stats);
    } catch (err: unknown) {
      return reply.status(errorStatus(err)).send({ error: errorMessage(err, "Failed") });
    }
  });

  app.get<{ Params: { wsId: string } }>("/api/workspaces/:wsId/files", async (req, reply) => {
    try {
      const files = await listWorkspaceFiles(req.params.wsId, dataDir);
      return reply.send(files);
    } catch (err: unknown) {
      return reply.status(errorStatus(err)).send({ error: errorMessage(err, "Failed") });
    }
  });

  app.get<{ Params: { wsId: string }; Querystring: { path?: string } }>(
    "/api/workspaces/:wsId/file",
    async (req, reply) => {
      try {
        const filePath = req.query.path;
        if (!filePath) {
          return reply.status(400).send({ error: "Missing 'path' query parameter" });
        }
        const result = await getWorkspaceFileContent(req.params.wsId, filePath, dataDir);
        return reply.send(result);
      } catch (err: unknown) {
        return reply.status(errorStatus(err)).send({ error: errorMessage(err, "Failed") });
      }
    },
  );

  app.post<{ Params: { wsId: string } }>("/api/workspaces/:wsId/merge", async (req, reply) => {
    try {
      await mergeWorkspace(req.params.wsId, dataDir);
      return reply.send({ status: "merged" });
    } catch (err: unknown) {
      return reply
        .status(errorStatus(err))
        .send({ error: errorMessage(err, "Merge failed") });
    }
  });
}
