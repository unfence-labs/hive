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
  getWorkspaceFileEntry,
  mergeWorkspace,
  archiveWorkspace,
} from "../workspaces/workspace-manager.js";
import { git } from "../utils/git.js";
import { endSession } from "../agents/agent-manager.js";
import { resolveChatCwd } from "../agents/chat-context.js";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { bareRepoPath, resolveDefaultBranch, workspacesDir } from "../utils/paths.js";
import { getDataDir } from "../state/state.js";
import { BadRequestError, errorMessage, errorStatus } from "../utils/errors.js";
import { readHiveConfig } from "../utils/hive-config.js";
import { startScript } from "../services/script-runner.js";
import { broadcastToWorkspace } from "../ws/stream.js";
import { headerFilename, rawFileContentType } from "../utils/raw-file.js";
import type { CreateWorkspaceSourceInput, DiffScope } from "../types.js";

const DIFF_SCOPES = new Set<DiffScope>(["combined", "committed", "uncommitted"]);

function parseDiffScope(scope: unknown): DiffScope {
  if (scope === undefined) return "combined";
  if (typeof scope === "string" && DIFF_SCOPES.has(scope as DiffScope)) {
    return scope as DiffScope;
  }
  throw new BadRequestError("Invalid diff scope");
}

function parseCreateSource(body: unknown): CreateWorkspaceSourceInput | undefined {
  if (body === undefined || body === null || typeof body !== "object") return undefined;
  const source = (body as { source?: unknown }).source;
  if (source === undefined || source === null) return undefined;
  if (typeof source !== "object") throw new BadRequestError("Invalid workspace source");
  const { kind, branch, number } = source as { kind?: unknown; branch?: unknown; number?: unknown };
  if (kind === "branch") {
    if (typeof branch !== "string" || !branch.trim()) {
      throw new BadRequestError("Workspace source of kind 'branch' requires a branch name");
    }
    return { kind, branch: branch.trim() };
  }
  if (kind === "pr" || kind === "issue") {
    if (typeof number !== "number" || !Number.isInteger(number) || number <= 0) {
      throw new BadRequestError(`Workspace source of kind '${kind}' requires a positive number`);
    }
    return { kind, number };
  }
  throw new BadRequestError("Invalid workspace source kind");
}

export async function workspaceRoutes(app: FastifyInstance, dataDir?: string) {
  app.post<{ Params: { id: string }; Body: unknown }>("/api/projects/:id/workspaces", async (req, reply) => {
    try {
      const source = parseCreateSource(req.body);
      const workspace = await createWorkspace(req.params.id, dataDir, source);

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

  app.get<{ Params: { wsId: string }; Querystring: { scope?: string } }>("/api/workspaces/:wsId/diff", async (req, reply) => {
    try {
      return reply.send(await getWorkspaceDiff(req.params.wsId, dataDir, parseDiffScope(req.query.scope)));
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

  app.get<{ Params: { wsId: string } }>("/api/workspaces/:wsId/file-completions", async (req, reply) => {
    try {
      const dir = dataDir ?? getDataDir();
      const wsPath = await resolveChatCwd(req.params.wsId, dir);
      if (!wsPath) return reply.status(404).send({ error: "Workspace not found" });

      const { stdout } = await git(["ls-files"], wsPath);
      const files = stdout.split("\n").filter(Boolean);
      return reply.send({ files });
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
    "/api/workspaces/:wsId/file/raw",
    async (req, reply) => {
      try {
        const filePath = req.query.path;
        if (!filePath) {
          return reply.status(400).send({ error: "Missing 'path' query parameter" });
        }

        const file = await getWorkspaceFileEntry(req.params.wsId, filePath, dataDir);
        reply.header("Cache-Control", "no-store");
        reply.header("Content-Type", rawFileContentType(file.path));
        reply.header("Content-Length", file.stat.size);
        reply.header("Content-Disposition", `inline; filename="${headerFilename(file.path)}"`);
        reply.header("X-Content-Type-Options", "nosniff");

        return reply.send(createReadStream(file.absolutePath));
      } catch (err: unknown) {
        return reply.status(errorStatus(err)).send({ error: errorMessage(err, "Failed") });
      }
    },
  );

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
      // End loaded sessions before archiving to avoid stale in-memory state.
      await endSession(req.params.wsId, dataDir);
      await archiveWorkspace(req.params.wsId, dataDir);
      return reply.status(204).send();
    } catch (err: unknown) {
      return reply
        .status(errorStatus(err))
        .send({ error: errorMessage(err, "Archive failed") });
    }
  });
}
