import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { getWorkspace } from "../workspaces/workspace-manager.js";
import { getScriptProcess } from "../services/script-runner.js";
import { isAuthorized } from "../utils/auth.js";
import type { ScriptType } from "../services/script-runner.js";

export interface ScriptWsRoutesOptions {
  dataDir?: string;
  authToken?: string;
}

export async function scriptWsRoutes(
  app: FastifyInstance,
  opts: ScriptWsRoutesOptions = {},
) {
  const { authToken } = opts;

  app.get<{
    Params: { wsId: string };
    Querystring: { token?: string; type?: string };
  }>(
    "/ws/script/:wsId",
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
      const scriptType = req.query.type as ScriptType | undefined;
      if (scriptType !== "setup" && scriptType !== "run") {
        socket.send(
          JSON.stringify({ type: "error", message: "Missing or invalid 'type' query param (setup|run)" }),
        );
        socket.close(1008, "Invalid type");
        return;
      }

      const result = await getWorkspace(wsId);
      if (!result) {
        socket.send(
          JSON.stringify({ type: "error", message: "Workspace not found" }),
        );
        socket.close(1008, "Workspace not found");
        return;
      }

      const proc = getScriptProcess(wsId, scriptType);
      if (!proc) {
        socket.send(
          JSON.stringify({ type: "error", message: `No ${scriptType} script process found` }),
        );
        socket.close(1008, "No script process");
        return;
      }

      // Replay buffered output
      if (proc.outputBuffer.length > 0) {
        const buffered = proc.outputBuffer.join("\n");
        if (socket.readyState === socket.OPEN) {
          socket.send(Buffer.from(buffered), { binary: true });
        }
      }

      // If script already finished, send exit immediately
      if (proc.state !== "running") {
        socket.send(
          JSON.stringify({ type: "exit", code: proc.exitCode ?? -1 }),
        );
        return;
      }

      // Wire live output
      const listenerId = nanoid(8);

      proc.listeners.set(listenerId, (data) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(Buffer.from(data), { binary: true });
        }
      });

      proc.exitListeners.set(listenerId, (code) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: "exit", code }));
        }
      });

      socket.send(JSON.stringify({ type: "ready" }));

      // WS → PTY (bidirectional for interactive prompts)
      socket.on("message", (raw, isBinary) => {
        if (proc.state !== "running") return;

        if (isBinary) {
          proc.pty.write((raw as Buffer).toString("utf8"));
        } else {
          try {
            const msg = JSON.parse((raw as Buffer).toString("utf8"));
            if (
              msg.type === "resize" &&
              typeof msg.cols === "number" &&
              typeof msg.rows === "number"
            ) {
              proc.pty.resize(
                Math.max(1, Math.min(500, msg.cols)),
                Math.max(1, Math.min(500, msg.rows)),
              );
            }
          } catch {
            // Ignore malformed JSON
          }
        }
      });

      // On WS close: detach listener but do NOT kill the process
      socket.on("close", () => {
        proc.listeners.delete(listenerId);
        proc.exitListeners.delete(listenerId);
      });
    },
  );
}
