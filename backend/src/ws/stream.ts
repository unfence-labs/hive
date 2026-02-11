import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { getActiveProcess } from "../agents/agent-manager.js";
import type { WsMessage } from "../types.js";

const agentClients = new Map<string, Set<WebSocket>>();

function broadcast(agentId: string, message: WsMessage) {
  const clients = agentClients.get(agentId);
  if (!clients) return;
  const payload = JSON.stringify(message);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
    }
  }
}

export async function streamRoutes(app: FastifyInstance) {
  app.get<{ Params: { agentId: string } }>(
    "/ws/agents/:agentId/stream",
    { websocket: true },
    (socket, req) => {
      const { agentId } = req.params;
      const proc = getActiveProcess(agentId);

      if (!proc) {
        const msg: WsMessage = { type: "status", data: "not_found", ts: Date.now() };
        socket.send(JSON.stringify(msg));
        socket.close();
        return;
      }

      // Register this client
      if (!agentClients.has(agentId)) {
        agentClients.set(agentId, new Set());
      }
      agentClients.get(agentId)!.add(socket);

      // Pipe process output to this client
      const onData = (chunk: string) => {
        if (socket.readyState === socket.OPEN) {
          const msg: WsMessage = { type: "stdout", data: chunk, ts: Date.now() };
          socket.send(JSON.stringify(msg));
        }
      };

      const onExit = (code: number) => {
        if (socket.readyState === socket.OPEN) {
          const msg: WsMessage = { type: "exit", code, ts: Date.now() };
          socket.send(JSON.stringify(msg));
          socket.close();
        }
        cleanup();
      };

      const onError = (err: Error) => {
        if (socket.readyState === socket.OPEN) {
          const msg: WsMessage = { type: "status", data: `error: ${err.message}`, ts: Date.now() };
          socket.send(JSON.stringify(msg));
          socket.close();
        }
        cleanup();
      };

      const cleanup = () => {
        proc.removeListener("data", onData);
        proc.removeListener("exit", onExit);
        proc.removeListener("error", onError);
        agentClients.get(agentId)?.delete(socket);
        if (agentClients.get(agentId)?.size === 0) {
          agentClients.delete(agentId);
        }
      };

      proc.on("data", onData);
      proc.on("exit", onExit);
      proc.on("error", onError);

      socket.on("close", cleanup);
    }
  );
}
