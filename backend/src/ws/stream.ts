import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import {
  getSession,
  sendMessage,
  stopStreaming,
  getOrCreateSession,
  type SessionOptions,
} from "../agents/agent-manager.js";
import type { WsIncoming, WsOutgoing } from "../types.js";

export interface StreamRoutesOptions {
  dataDir?: string;
  sessionOptions?: SessionOptions;
}

function sendOutgoing(socket: WebSocket, msg: WsOutgoing): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

export async function streamRoutes(app: FastifyInstance, opts: StreamRoutesOptions = {}) {
  const { dataDir, sessionOptions } = opts;

  app.get<{ Params: { wsId: string } }>(
    "/ws/session/:wsId",
    { websocket: true },
    async (socket, req) => {
      const { wsId } = req.params;

      // Check if session exists already
      let session = getSession(wsId);

      if (session) {
        // Send current status + history
        sendOutgoing(socket, {
          type: "status",
          status: "busy",
          sessionId: session.sessionId,
          streaming: session.status === "streaming",
        });
        try {
          const messages = await session.getMessages();
          if (messages.length > 0) {
            sendOutgoing(socket, { type: "history", messages });
          }
        } catch {
          // History load failure is non-fatal
        }
      } else {
        sendOutgoing(socket, { type: "status", status: "idle", streaming: false });
      }

      // Pipe session events to this WS client
      function attachSessionListeners() {
        if (!session) return;

        const onMessage = (msg: WsOutgoing) => sendOutgoing(socket, msg);
        const onError = (err: Error) => {
          sendOutgoing(socket, { type: "error", message: err.message });
        };
        const onExit = (_code: number) => {
          const stillActive = getSession(wsId) === session;
          if (stillActive) {
            // Session was stopped (not ended) — still alive, just not streaming
            sendOutgoing(socket, {
              type: "status",
              status: "busy",
              sessionId: session!.sessionId,
              streaming: false,
            });
          } else {
            // Session was ended — removed from activeSessions
            sendOutgoing(socket, {
              type: "status",
              status: "idle",
              streaming: false,
            });
            cleanupListeners?.();
            cleanupListeners = undefined;
            session = null;
          }
        };

        session.on("message", onMessage);
        session.on("error", onError);
        session.on("exit", onExit);

        // Return cleanup function
        return () => {
          session?.removeListener("message", onMessage);
          session?.removeListener("error", onError);
          session?.removeListener("exit", onExit);
        };
      }

      let cleanupListeners = attachSessionListeners();

      socket.on("close", () => {
        cleanupListeners?.();
      });

      socket.on("message", async (raw) => {
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
              // Auto-create session if needed
              if (!session) {
                const result = await getOrCreateSession(wsId, dataDir, sessionOptions);
                session = result.session;
                cleanupListeners = attachSessionListeners();
              }
              session.sendMessage(incoming.content);
              sendOutgoing(socket, {
                type: "status",
                status: "busy",
                sessionId: session.sessionId,
                streaming: true,
              });
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : "Failed to send message";
              sendOutgoing(socket, { type: "error", message: msg });
            }
            break;
          }
          case "stop": {
            try {
              if (session) {
                session.stop();
              }
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : "Failed to stop";
              sendOutgoing(socket, { type: "error", message: msg });
            }
            break;
          }
        }
      });
    },
  );
}
