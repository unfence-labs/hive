import type { FastifyInstance } from "fastify";
import { resolve } from "node:path";
import { getWorkspace } from "../workspaces/workspace-manager.js";
import { readHiveConfig } from "../utils/hive-config.js";
import {
  startScript,
  stopScript,
  getScriptStatus,
} from "../services/script-runner.js";
import { startTerminal, stopTerminal } from "../services/terminal-runner.js";
import { getPreviewProxy, notePreviewOutput } from "../services/preview-proxy.js";
import type { PtyProcess } from "../services/pty-process.js";
import { listWorkspaceSessions } from "../agents/session-dispatch.js";
import { broadcastToWorkspace } from "../ws/stream.js";
import { workspacesDir } from "../utils/paths.js";
import { getDataDir } from "../state/state.js";
import { errorMessage } from "../utils/errors.js";

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

  /** Watch PTY output for a dev-server URL so the preview panel can offer it. */
  function watchForPreviewUrl(wsId: string, proc: PtyProcess) {
    const listenerId = `preview-detect-${Date.now()}`;
    proc.listeners.set(listenerId, (data) => {
      const url = notePreviewOutput(wsId, data);
      if (url) {
        broadcastToWorkspace(wsId, {
          type: "preview_status",
          status: { detectedUrl: url, proxy: getPreviewProxy(wsId) },
        });
      }
    });
  }

  function startAndBroadcast(
    wsId: string,
    scriptType: string,
    command: string | undefined,
    wsPath: string,
  ) {
    const proc = startScript(wsId, scriptType, command, wsPath);
    watchForPreviewUrl(wsId, proc);
    broadcastToWorkspace(wsId, {
      type: "script_status",
      scriptType,
      state: "running",
    });

    const listenerId = `broadcast-${Date.now()}`;
    proc.exitListeners.set(listenerId, (code) => {
      broadcastToWorkspace(wsId, {
        type: "script_status",
        scriptType,
        state: code === 0 ? "done" : "error",
        exitCode: code,
      });
      proc.exitListeners.delete(listenerId);
    });
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
      const scriptType = req.params.type;

      const resolved = await resolveWsPath(req.params.wsId);
      if (!resolved) return reply.status(404).send({ error: "Workspace not found" });

      const config = await readHiveConfig(resolved.wsPath);

      // Resolve command: "setup" is special, everything else is a run script name
      const command = scriptType === "setup"
        ? config?.scripts?.setup
        : config?.scripts?.run?.[scriptType];

      if (!command) {
        return reply.status(400).send({ error: `No "${scriptType}" script defined in hive.json` });
      }

      try {
        startAndBroadcast(req.params.wsId, scriptType, command, resolved.wsPath);
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
      const scriptType = req.params.type;

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

  // POST /api/workspaces/:wsId/terminal/start — interactive shell
  app.post<{ Params: { wsId: string } }>(
    "/api/workspaces/:wsId/terminal/start",
    async (req, reply) => {
      const { wsId } = req.params;
      const resolved = await resolveWsPath(wsId);
      if (!resolved) return reply.status(404).send({ error: "Workspace not found" });

      try {
        startAndBroadcast(wsId, "terminal", undefined, resolved.wsPath);
        return reply.send({ started: true });
      } catch (err: unknown) {
        return reply.status(409).send({ error: errorMessage(err, "Failed to start terminal") });
      }
    },
  );

  // POST /api/workspaces/:wsId/terminal/stop
  app.post<{ Params: { wsId: string } }>(
    "/api/workspaces/:wsId/terminal/stop",
    async (req, reply) => {
      const { wsId } = req.params;
      const stopped = stopScript(wsId, "terminal");
      if (!stopped) {
        return reply.status(409).send({ error: "No running terminal to stop" });
      }

      broadcastToWorkspace(wsId, {
        type: "script_status",
        scriptType: "terminal",
        state: "idle",
      });

      return reply.send({ stopped: true });
    },
  );

  // POST /api/workspaces/:wsId/terminal-tabs/:sessionId/start — terminal-tab shell.
  // Each tab gets its own PTY in the terminal registry (NOT the script runner),
  // so an open terminal never lights up the workspace "script running" indicator
  // and no `script_status` is broadcast. The pane is driven entirely by its own
  // `/ws/terminal` socket.
  app.post<{ Params: { wsId: string; sessionId: string } }>(
    "/api/workspaces/:wsId/terminal-tabs/:sessionId/start",
    async (req, reply) => {
      const { wsId, sessionId } = req.params;
      const resolved = await resolveWsPath(wsId);
      if (!resolved) return reply.status(404).send({ error: "Workspace not found" });

      // Only terminal-kind sessions get a PTY here.
      const sessions = await listWorkspaceSessions(wsId, dir);
      const session = sessions.find((s) => s.sessionId === sessionId);
      if (!session) {
        return reply.status(404).send({ error: "Session not found" });
      }
      if (session.kind !== "terminal") {
        return reply.status(400).send({ error: "Session is not a terminal" });
      }

      try {
        // Terminal-tab shells also feed preview detection: a dev server started
        // by hand in a Hive terminal should light up the preview affordance too.
        watchForPreviewUrl(wsId, startTerminal(wsId, sessionId, resolved.wsPath));
        return reply.send({ started: true });
      } catch (err: unknown) {
        return reply.status(409).send({ error: errorMessage(err, "Failed to start terminal") });
      }
    },
  );

  // POST /api/workspaces/:wsId/terminal-tabs/:sessionId/stop
  app.post<{ Params: { wsId: string; sessionId: string } }>(
    "/api/workspaces/:wsId/terminal-tabs/:sessionId/stop",
    async (req, reply) => {
      const { wsId, sessionId } = req.params;
      const stopped = stopTerminal(wsId, sessionId);
      if (!stopped) {
        return reply.status(409).send({ error: "No running terminal to stop" });
      }

      return reply.send({ stopped: true });
    },
  );
}
