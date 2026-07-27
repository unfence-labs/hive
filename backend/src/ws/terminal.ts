import type { FastifyInstance } from "fastify";
import { getWorkspace } from "../workspaces/workspace-manager.js";
import { getTerminalProcess } from "../services/terminal-runner.js";
import { isAuthorized, type AuthExpectationInput } from "../utils/auth.js";
import { attachPtyToSocket } from "./pty-socket.js";

export interface TerminalWsRoutesOptions {
  dataDir?: string;
  auth?: AuthExpectationInput;
}

/**
 * WebSocket endpoint for terminal-tab sessions. Resolves the PTY from the
 * terminal registry keyed by the session id and bridges it with the same
 * {@link attachPtyToSocket} helper as `/ws/script`.
 */
export async function terminalWsRoutes(
  app: FastifyInstance,
  opts: TerminalWsRoutesOptions = {},
) {
  const { auth, dataDir } = opts;

  app.get<{
    Params: { wsId: string };
    Querystring: { token?: string; sessionId?: string };
  }>(
    "/ws/terminal/:wsId",
    { websocket: true },
    async (socket, req) => {
      const queryToken =
        typeof req.query.token === "string" ? req.query.token : undefined;
      if (!isAuthorized(req.headers, auth, queryToken)) {
        socket.send(JSON.stringify({ type: "error", message: "Unauthorized" }));
        socket.close(1008, "Unauthorized");
        return;
      }

      const { wsId } = req.params;
      const sessionId =
        typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;
      if (!sessionId) {
        socket.send(
          JSON.stringify({ type: "error", message: "Missing 'sessionId' query param" }),
        );
        socket.close(1008, "Invalid sessionId");
        return;
      }

      const result = await getWorkspace(wsId, dataDir);
      if (!result) {
        socket.send(
          JSON.stringify({ type: "error", message: "Workspace not found" }),
        );
        socket.close(1008, "Workspace not found");
        return;
      }

      const proc = getTerminalProcess(wsId, sessionId);
      if (!proc) {
        socket.send(
          JSON.stringify({ type: "error", message: "No terminal process found" }),
        );
        socket.close(1008, "No terminal process");
        return;
      }

      attachPtyToSocket(socket, proc);
    },
  );
}
