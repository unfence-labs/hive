import type { FastifyInstance } from "fastify";
import { getWorkspace } from "../workspaces/workspace-manager.js";
import { getScriptProcess } from "../services/script-runner.js";
import { isAuthorized, type AuthExpectationInput } from "../utils/auth.js";
import { attachPtyToSocket } from "./pty-socket.js";

export interface ScriptWsRoutesOptions {
  dataDir?: string;
  auth?: AuthExpectationInput;
}

export async function scriptWsRoutes(
  app: FastifyInstance,
  opts: ScriptWsRoutesOptions = {},
) {
  const { auth } = opts;

  app.get<{
    Params: { wsId: string };
    Querystring: { token?: string; type?: string };
  }>(
    "/ws/script/:wsId",
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
      const scriptType = typeof req.query.type === "string" ? req.query.type : undefined;
      if (!scriptType) {
        socket.send(
          JSON.stringify({ type: "error", message: "Missing 'type' query param" }),
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

      attachPtyToSocket(socket, proc);
    },
  );
}
