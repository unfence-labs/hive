import type { FastifyInstance } from "fastify";
import { resolve } from "node:path";
import { getWorkspace } from "../workspaces/workspace-manager.js";
import { readHiveConfig } from "../utils/hive-config.js";
import {
  startScript,
  stopScript,
  getScriptStatus,
  getScriptProcess,
} from "../services/script-runner.js";
import { broadcastToWorkspace } from "../ws/stream.js";
import { workspacesDir } from "../utils/paths.js";
import { getDataDir } from "../state/state.js";
import { errorMessage } from "../utils/errors.js";
import type { ScriptType } from "../services/script-runner.js";

export async function scriptRoutes(app: FastifyInstance, dataDir?: string) {
  const dir = dataDir ?? getDataDir();

  /** Resolve workspace path or send 404. */
  async function resolveWsPath(wsId: string) {
    const result = await getWorkspace(wsId, dir);
    if (!result) return null;
    return {
      wsPath: resolve(workspacesDir(dir, result.projectState.id), result.workspace.name),
      workspace: result.workspace,
    };
  }

  // GET /api/workspaces/:wsId/scripts — config + status
  app.get<{ Params: { wsId: string } }>(
    "/api/workspaces/:wsId/scripts",
    async (req, reply) => {
      const resolved = await resolveWsPath(req.params.wsId);
      if (!resolved) return reply.status(404).send({ error: "Workspace not found" });

      const config = await readHiveConfig(resolved.wsPath);
      const status = getScriptStatus(req.params.wsId);

      return reply.send({ config, status });
    },
  );

  // POST /api/workspaces/:wsId/scripts/:type/start
  app.post<{ Params: { wsId: string; type: string } }>(
    "/api/workspaces/:wsId/scripts/:type/start",
    async (req, reply) => {
      const scriptType = req.params.type as ScriptType;
      if (scriptType !== "setup" && scriptType !== "run") {
        return reply.status(400).send({ error: "Invalid script type (setup|run)" });
      }

      const resolved = await resolveWsPath(req.params.wsId);
      if (!resolved) return reply.status(404).send({ error: "Workspace not found" });

      const config = await readHiveConfig(resolved.wsPath);
      const command = config?.scripts?.[scriptType];
      if (!command) {
        return reply.status(400).send({ error: `No "${scriptType}" script defined in hive.json` });
      }

      try {
        const proc = startScript(req.params.wsId, scriptType, command, resolved.wsPath);
        broadcastToWorkspace(req.params.wsId, {
          type: "script_status",
          scriptType,
          state: "running",
        });
        // Broadcast exit status when the process finishes
        const listenerId = `broadcast-${Date.now()}`;
        proc.exitListeners.set(listenerId, (code) => {
          broadcastToWorkspace(req.params.wsId, {
            type: "script_status",
            scriptType,
            state: code === 0 ? "done" : "error",
            exitCode: code,
          });
          proc.exitListeners.delete(listenerId);
        });
        return reply.send({ started: true });
      } catch (err: unknown) {
        return reply.status(409).send({ error: errorMessage(err, "Failed to start script") });
      }
    },
  );

  // POST /api/workspaces/:wsId/scripts/:type/stop
  app.post<{ Params: { wsId: string; type: string } }>(
    "/api/workspaces/:wsId/scripts/:type/stop",
    async (req, reply) => {
      const scriptType = req.params.type as ScriptType;
      if (scriptType !== "setup" && scriptType !== "run") {
        return reply.status(400).send({ error: "Invalid script type (setup|run)" });
      }

      const stopped = stopScript(req.params.wsId, scriptType);
      if (!stopped) {
        return reply.status(409).send({ error: `No running "${scriptType}" script to stop` });
      }

      broadcastToWorkspace(req.params.wsId, {
        type: "script_status",
        scriptType,
        state: "idle",
      });

      return reply.send({ stopped: true });
    },
  );
}
