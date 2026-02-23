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
  archiveWorkspace,
} from "../workspaces/workspace-manager.js";
import { endSession } from "../agents/agent-manager.js";
import { join } from "node:path";
import { bareRepoPath, resolveDefaultBranch, workspacesDir } from "../utils/paths.js";
import { getDataDir } from "../state/state.js";
import { errorMessage, errorStatus } from "../utils/errors.js";
import { parseGitHubRepo, fetchPrForBranch } from "../utils/github.js";
import { getBranchName } from "../services/git-sync.js";
import { readHiveConfig } from "../utils/hive-config.js";
import { startScript } from "../services/script-runner.js";
import { broadcastToWorkspace } from "../ws/stream.js";
import type { PrStatusResponse } from "../types.js";

export async function workspaceRoutes(app: FastifyInstance, dataDir?: string) {
  app.post<{ Params: { id: string } }>("/api/projects/:id/workspaces", async (req, reply) => {
    try {
      const workspace = await createWorkspace(req.params.id, dataDir);

      // Auto-start setup script if hive.json defines one
      const dir = dataDir ?? getDataDir();
      const wsPath = join(workspacesDir(dir, req.params.id), workspace.name);
      try {
        const config = await readHiveConfig(wsPath);
        const setupCmd = config?.scripts?.setup;
        if (setupCmd) {
          const proc = startScript(workspace.id, "setup", setupCmd, wsPath);
          broadcastToWorkspace(workspace.id, {
            type: "script_status",
            scriptType: "setup",
            state: "running",
          });
          const listenerId = `auto-setup-${Date.now()}`;
          proc.exitListeners.set(listenerId, (code) => {
            broadcastToWorkspace(workspace.id, {
              type: "script_status",
              scriptType: "setup",
              state: code === 0 ? "done" : "error",
              exitCode: code,
            });
            proc.exitListeners.delete(listenerId);
          });
        }
      } catch (err) {
        app.log.warn({ err, wsId: workspace.id }, "Auto-start setup script failed");
      }

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

    const dir = dataDir ?? getDataDir();
    const bare = bareRepoPath(dir, result.projectState.id);
    const defaultBranch = await resolveDefaultBranch(bare);
    const worktreePath = join(workspacesDir(dir, result.projectState.id), result.workspace.name);

    return reply.send({
      ...result.workspace,
      projectName: result.projectState.name,
      defaultBranch,
      worktreePath,
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

  // ── PR status (on-demand, cached) ─────────────────────────────────
  const prCache = new Map<string, { data: PrStatusResponse; at: number }>();
  const PR_TTL = 15_000;

  app.get<{ Params: { wsId: string } }>("/api/workspaces/:wsId/pr-status", async (req, reply) => {
    try {
      const { wsId } = req.params;

      const cached = prCache.get(wsId);
      if (cached && Date.now() - cached.at < PR_TTL) {
        return reply.send(cached.data);
      }

      const result = await getWorkspace(wsId, dataDir);
      if (!result) return reply.status(404).send({ error: "Workspace not found" });

      const ghRepo = parseGitHubRepo(result.projectState.url);
      if (!ghRepo) {
        const data: PrStatusResponse = { pr: null };
        prCache.set(wsId, { data, at: Date.now() });
        return reply.send(data);
      }

      const dir = dataDir ?? getDataDir();
      const wsPath = join(workspacesDir(dir, result.projectState.id), result.workspace.name);
      let branch: string;
      try {
        branch = await getBranchName(wsPath);
      } catch {
        branch = result.workspace.branch;
      }

      const prResult = await fetchPrForBranch(ghRepo.owner, ghRepo.repo, branch);
      const data: PrStatusResponse = {
        pr: prResult.pr,
        ...(prResult.error ? { error: prResult.error } : {}),
      };
      prCache.set(wsId, { data, at: Date.now() });
      return reply.send(data);
    } catch (err: unknown) {
      return reply
        .status(errorStatus(err))
        .send({ error: errorMessage(err, "Failed to fetch PR status") });
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

  app.post<{ Params: { wsId: string } }>("/api/workspaces/:wsId/archive", async (req, reply) => {
    try {
      // End any active session before archiving
      try {
        await endSession(req.params.wsId, dataDir);
      } catch {
        // No active session — fine
      }
      await archiveWorkspace(req.params.wsId, dataDir);
      return reply.status(204).send();
    } catch (err: unknown) {
      return reply
        .status(errorStatus(err))
        .send({ error: errorMessage(err, "Archive failed") });
    }
  });
}
