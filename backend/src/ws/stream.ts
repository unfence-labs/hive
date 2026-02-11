import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import {
  getActiveProcess,
  getConversation,
  sendMessage,
  stopConversation,
} from "../agents/agent-manager.js";
import type { WsMessage, WsIncoming, WsOutgoing } from "../types.js";

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

function sendOutgoing(socket: WebSocket, msg: WsOutgoing): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

export async function streamRoutes(app: FastifyInstance) {
  // ── Print mode: unidirectional stream ─────────────────────────────

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

  // ── Conversation mode: bidirectional WS ───────────────────────────

  app.get<{ Params: { wsId: string } }>(
    "/ws/conversation/:wsId",
    { websocket: true },
    (socket, req) => {
      const { wsId } = req.params;
      const session = getConversation(wsId);

      if (!session) {
        sendOutgoing(socket, { type: "error", message: "No active conversation for this workspace" });
        socket.close();
        return;
      }

      // Send current status
      sendOutgoing(socket, { type: "status", status: session.status });

      // Pipe session events to this WS client
      const onMessage = (msg: WsOutgoing) => sendOutgoing(socket, msg);
      const onError = (err: Error) => {
        sendOutgoing(socket, { type: "error", message: err.message });
      };
      const onExit = (_code: number) => {
        sendOutgoing(socket, { type: "status", status: session.status });
      };

      session.on("message", onMessage);
      session.on("error", onError);
      session.on("exit", onExit);

      const cleanup = () => {
        session.removeListener("message", onMessage);
        session.removeListener("error", onError);
        session.removeListener("exit", onExit);
      };

      socket.on("close", cleanup);

      socket.on("message", (raw) => {
        let incoming: WsIncoming;
        try {
          incoming = JSON.parse(raw.toString()) as WsIncoming;
        } catch {
          sendOutgoing(socket, { type: "error", message: "Invalid JSON" });
          return;
        }

        switch (incoming.type) {
          case "user_message": {
            try {
              sendMessage(wsId, incoming.content);
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : "Failed to send message";
              sendOutgoing(socket, { type: "error", message: msg });
            }
            break;
          }
          case "stop": {
            try {
              stopConversation(wsId);
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : "Failed to stop";
              sendOutgoing(socket, { type: "error", message: msg });
            }
            break;
          }
        }
      });
    }
  );
}
