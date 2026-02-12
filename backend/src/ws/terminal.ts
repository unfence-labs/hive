import type { FastifyInstance } from "fastify";
import * as pty from "node-pty";
import type { IPty } from "node-pty";
import { join, resolve } from "node:path";
import { getWorkspace } from "../workspaces/workspace-manager.js";
import { workspacesDir } from "../utils/paths.js";
import { getDataDir } from "../state/state.js";
import { isAuthorized } from "../utils/auth.js";

export interface TerminalRoutesOptions {
  dataDir?: string;
  authToken?: string;
}

const activePtys = new Map<string, IPty>();

export async function terminalRoutes(
  app: FastifyInstance,
  opts: TerminalRoutesOptions = {},
) {
  const { authToken } = opts;
  const dataDir = opts.dataDir ?? getDataDir();

  app.get<{ Params: { wsId: string }; Querystring: { token?: string } }>(
    "/ws/terminal/:wsId",
    { websocket: true },
    async (socket, req) => {
      const queryToken =
        typeof req.query.token === "string" ? req.query.token : undefined;
      if (!isAuthorized(req.headers, authToken, queryToken)) {
        socket.send(JSON.stringify({ type: "error", message: "Unauthorized" }));
        socket.close(1008, "Unauthorized");
        return;
      }

      const { wsId } = req.params;
      const result = await getWorkspace(wsId, dataDir);
      if (!result) {
        socket.send(
          JSON.stringify({ type: "error", message: "Workspace not found" }),
        );
        socket.close(1008, "Workspace not found");
        return;
      }

      const { projectState, workspace } = result;
      const workspacePath = resolve(
        join(workspacesDir(dataDir, projectState.id), workspace.name),
      );

      // Kill existing PTY for this workspace if any
      const existing = activePtys.get(wsId);
      if (existing) {
        existing.kill();
        activePtys.delete(wsId);
      }

      const shell = process.env.SHELL || "/bin/zsh";
      let ptyProcess: IPty;
      try {
        ptyProcess = pty.spawn(shell, ["-l"], {
          cwd: workspacePath,
          env: { ...process.env, TERM: "xterm-256color" } as Record<
            string,
            string
          >,
          cols: 80,
          rows: 24,
          name: "xterm-256color",
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to spawn shell";
        socket.send(JSON.stringify({ type: "error", message: msg }));
        socket.close(1011, msg);
        return;
      }

      activePtys.set(wsId, ptyProcess);

      // PTY output → WebSocket (binary)
      ptyProcess.onData((data) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(Buffer.from(data), { binary: true });
        }
      });

      ptyProcess.onExit(({ exitCode }) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: "exit", code: exitCode }));
        }
        if (activePtys.get(wsId) === ptyProcess) {
          activePtys.delete(wsId);
        }
      });

      socket.send(JSON.stringify({ type: "ready" }));

      // WebSocket → PTY
      socket.on("message", (raw, isBinary) => {
        if (isBinary) {
          ptyProcess.write(Buffer.from(raw as Buffer).toString("utf8"));
        } else {
          try {
            const msg = JSON.parse((raw as Buffer).toString("utf8"));
            if (
              msg.type === "resize" &&
              typeof msg.cols === "number" &&
              typeof msg.rows === "number"
            ) {
              ptyProcess.resize(
                Math.max(1, Math.min(500, msg.cols)),
                Math.max(1, Math.min(500, msg.rows)),
              );
            }
          } catch {
            // Ignore malformed JSON
          }
        }
      });

      socket.on("close", () => {
        const current = activePtys.get(wsId);
        if (current === ptyProcess) {
          ptyProcess.kill();
          activePtys.delete(wsId);
        }
      });
    },
  );
}

/** For test cleanup only. */
export function _clearActivePtys(): void {
  for (const [id, p] of activePtys) {
    p.kill();
    activePtys.delete(id);
  }
}
