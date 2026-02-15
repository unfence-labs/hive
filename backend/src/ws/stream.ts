import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import {
  getSession,
  getOrCreateSession,
  getSessionMessages,
  type SessionOptions,
} from "../agents/agent-manager.js";
import { errorMessage } from "../utils/errors.js";
import { isAuthorized } from "../utils/auth.js";
import type { WsIncoming, WsOutgoing } from "../types.js";

interface GitSyncSnapshotProvider {
  getCachedBranchInfo: (workspaceId: string) => Extract<WsOutgoing, { type: "branch_info" }>["info"] | undefined;
  getCachedDiffStats: (workspaceId: string) => Extract<WsOutgoing, { type: "diff_stats" }>["stats"] | undefined;
}

export interface StreamRoutesOptions {
  dataDir?: string;
  sessionOptions?: SessionOptions;
  authToken?: string;
  gitSyncSnapshotProvider?: GitSyncSnapshotProvider;
}

function sendOutgoing(socket: WebSocket, msg: WsOutgoing): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

type ActiveSession = NonNullable<ReturnType<typeof getSession>>;

interface WorkspaceChannel {
  sockets: Set<WebSocket>;
  session?: ActiveSession;
  detachSession?: () => void;
}

const channels = new Map<string, WorkspaceChannel>();

/** Send a message to all sockets connected to a workspace channel. */
export function broadcastToWorkspace(workspaceId: string, msg: WsOutgoing): void {
  const channel = channels.get(workspaceId);
  if (!channel) return;
  for (const socket of channel.sockets) {
    sendOutgoing(socket, msg);
  }
}

export function _getChannelsForTests(): Map<string, WorkspaceChannel> {
  return channels;
}

export async function streamRoutes(app: FastifyInstance, opts: StreamRoutesOptions = {}) {
  const {
    dataDir,
    sessionOptions,
    authToken,
    gitSyncSnapshotProvider,
  } = opts;

  const getOrCreateChannel = (workspaceId: string): WorkspaceChannel => {
    const existing = channels.get(workspaceId);
    if (existing) return existing;
    const created: WorkspaceChannel = { sockets: new Set<WebSocket>() };
    channels.set(workspaceId, created);
    return created;
  };

  const sendToChannel = (channel: WorkspaceChannel, msg: WsOutgoing): void => {
    for (const socket of channel.sockets) {
      sendOutgoing(socket, msg);
    }
  };

  const detachSessionListeners = (channel: WorkspaceChannel): void => {
    channel.detachSession?.();
    channel.detachSession = undefined;
    channel.session = undefined;
  };

  const attachSessionListeners = (
    workspaceId: string,
    channel: WorkspaceChannel,
    session: ActiveSession,
  ): void => {
    if (channel.session === session && channel.detachSession) {
      return;
    }

    detachSessionListeners(channel);
    channel.session = session;

    const onMessage = (msg: WsOutgoing) => sendToChannel(channel, msg);
    const onError = (err: Error) => {
      sendToChannel(channel, { type: "error", message: err.message });
    };
    const onExit = (_code: number) => {
      const current = getSession(workspaceId);
      if (current === session) {
        // Natural completion — this session is still the active one
        sendToChannel(channel, {
          type: "status",
          status: "busy",
          sessionId: session.sessionId,
          streaming: false,
        });
      } else if (current) {
        // Session was parked/replaced — a new session is now active.
        // Don't send stale idle status; just silently detach from old session.
        detachSessionListeners(channel);
      } else {
        // Session ended entirely, no replacement
        sendToChannel(channel, {
          type: "status",
          status: "idle",
          streaming: false,
        });
        detachSessionListeners(channel);
      }
    };

    session.on("message", onMessage);
    session.on("error", onError);
    session.on("exit", onExit);

    channel.detachSession = () => {
      session.removeListener("message", onMessage);
      session.removeListener("error", onError);
      session.removeListener("exit", onExit);
    };
  };

  app.get<{ Params: { wsId: string }; Querystring: { token?: string } }>(
    "/ws/session/:wsId",
    { websocket: true },
    async (socket, req) => {
      const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
      if (!isAuthorized(req.headers, authToken, queryToken)) {
        sendOutgoing(socket, { type: "error", message: "Unauthorized" });
        socket.close(1008, "Unauthorized");
        return;
      }

      const { wsId } = req.params;
      const channel = getOrCreateChannel(wsId);
      channel.sockets.add(socket);

      const session = getSession(wsId);

      if (session) {
        attachSessionListeners(wsId, channel, session);
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
        try {
          const messages = await getSessionMessages(wsId, dataDir);
          if (messages.length > 0) {
            sendOutgoing(socket, { type: "history", messages });
          }
        } catch {
          // Ignore missing/corrupt persisted history.
        }
      }

      const branchInfo = gitSyncSnapshotProvider?.getCachedBranchInfo(wsId);
      if (branchInfo) {
        sendOutgoing(socket, { type: "branch_info", info: branchInfo });
      }

      const diffStats = gitSyncSnapshotProvider?.getCachedDiffStats(wsId);
      if (diffStats) {
        sendOutgoing(socket, { type: "diff_stats", stats: diffStats });
      }

      socket.on("close", () => {
        channel.sockets.delete(socket);
        if (channel.sockets.size === 0) {
          detachSessionListeners(channel);
          channels.delete(wsId);
        }
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
              let activeSession = getSession(wsId);
              if (!activeSession) {
                const result = await getOrCreateSession(wsId, dataDir, sessionOptions);
                activeSession = result.session;
              }
              attachSessionListeners(wsId, channel, activeSession);
              activeSession.sendMessage(incoming.content, incoming.options, incoming.images);
              sendToChannel(channel, {
                type: "status",
                status: "busy",
                sessionId: activeSession.sessionId,
                streaming: true,
              });
            } catch (err: unknown) {
              sendOutgoing(socket, { type: "error", message: errorMessage(err, "Failed to send message") });
            }
            break;
          }
          case "stop": {
            try {
              if (channel.session) {
                channel.session.stop();
              }
            } catch (err: unknown) {
              sendOutgoing(socket, { type: "error", message: errorMessage(err, "Failed to stop") });
            }
            break;
          }
          case "tool_input_response": {
            try {
              let activeSession = getSession(wsId);
              if (!activeSession) {
                const result = await getOrCreateSession(wsId, dataDir, sessionOptions);
                activeSession = result.session;
              }
              attachSessionListeners(wsId, channel, activeSession);
              activeSession.respondToToolInput(incoming.toolName, incoming.result);
              sendToChannel(channel, {
                type: "status",
                status: "busy",
                sessionId: activeSession.sessionId,
                streaming: true,
              });
            } catch (err: unknown) {
              sendOutgoing(socket, { type: "error", message: errorMessage(err, "Failed to respond to tool input") });
            }
            break;
          }
        }
      });
    },
  );
}
