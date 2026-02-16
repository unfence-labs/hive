import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import {
  activateSession,
  getSession,
  getSessionById,
  getOrCreateSession,
  getSessionMessages,
  stopStreaming,
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

interface SocketState {
  focusedSessionId?: string;
}

interface WorkspaceChannel {
  sockets: Set<WebSocket>;
  socketStates: Map<WebSocket, SocketState>;
  detachBySessionId: Map<string, () => void>;
  pendingToolRequests: Map<string, ActiveSession>;
  sessionsById: Map<string, ActiveSession>;
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
    const created: WorkspaceChannel = {
      sockets: new Set<WebSocket>(),
      socketStates: new Map<WebSocket, SocketState>(),
      detachBySessionId: new Map<string, () => void>(),
      pendingToolRequests: new Map<string, ActiveSession>(),
      sessionsById: new Map<string, ActiveSession>(),
    };
    channels.set(workspaceId, created);
    return created;
  };

  const sendToSession = (channel: WorkspaceChannel, sessionId: string, msg: WsOutgoing): void => {
    for (const [socket, state] of channel.socketStates) {
      if (state.focusedSessionId !== sessionId) continue;
      sendOutgoing(socket, msg);
    }
  };

  const setSocketFocus = (channel: WorkspaceChannel, socket: WebSocket, sessionId: string): void => {
    const state = channel.socketStates.get(socket);
    if (!state) return;
    state.focusedSessionId = sessionId;
  };

  const sendSessionBootstrap = async (socket: WebSocket, session: ActiveSession): Promise<void> => {
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
      // History load failure is non-fatal.
    }
  };

  const detachAllSessionListeners = (channel: WorkspaceChannel): void => {
    for (const detach of channel.detachBySessionId.values()) {
      detach();
    }
    channel.detachBySessionId.clear();
    channel.sessionsById.clear();
    channel.pendingToolRequests.clear();
  };

  const attachSessionListeners = (
    channel: WorkspaceChannel,
    session: ActiveSession,
  ): void => {
    if (channel.detachBySessionId.has(session.sessionId)) {
      return;
    }

    channel.sessionsById.set(session.sessionId, session);

    const onMessage = (msg: WsOutgoing) => {
      if (msg.type === "tool_input_required") {
        channel.pendingToolRequests.set(msg.requestId, session);
      }
      sendToSession(channel, session.sessionId, msg);
    };
    const onError = (err: Error) => {
      sendToSession(channel, session.sessionId, { type: "error", message: err.message });
    };
    const onExit = (_code: number) => {
      sendToSession(channel, session.sessionId, {
        type: "status",
        status: "busy",
        sessionId: session.sessionId,
        streaming: false,
      });
    };

    session.on("message", onMessage);
    session.on("error", onError);
    session.on("exit", onExit);

    channel.detachBySessionId.set(session.sessionId, () => {
      session.removeListener("message", onMessage);
      session.removeListener("error", onError);
      session.removeListener("exit", onExit);
    });
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
      channel.socketStates.set(socket, {});

      const session = getSession(wsId);

      if (session) {
        attachSessionListeners(channel, session);
        setSocketFocus(channel, socket, session.sessionId);
        await sendSessionBootstrap(socket, session);
      } else {
        sendOutgoing(socket, { type: "status", status: "idle", streaming: false });
        try {
          const messages = await getSessionMessages(wsId, dataDir);
          if (messages.length > 0) {
            const firstSessionId = messages[0]?.sessionId;
            if (firstSessionId) {
              setSocketFocus(channel, socket, firstSessionId);
            }
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
        channel.socketStates.delete(socket);
        if (channel.sockets.size === 0) {
          detachAllSessionListeners(channel);
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
          case "switch_session": {
            try {
              const session = await activateSession(
                wsId,
                incoming.sessionId,
                dataDir,
                sessionOptions,
              );
              attachSessionListeners(channel, session);
              setSocketFocus(channel, socket, session.sessionId);
              await sendSessionBootstrap(socket, session);
            } catch (err: unknown) {
              sendOutgoing(socket, { type: "error", message: errorMessage(err, "Failed to switch session") });
            }
            break;
          }
          case "user_message": {
            try {
              const state = channel.socketStates.get(socket);
              const requestedSessionId = incoming.sessionId ?? state?.focusedSessionId;

              let targetSession: ActiveSession | undefined;
              if (requestedSessionId) {
                targetSession = channel.sessionsById.get(requestedSessionId)
                  ?? getSessionById(wsId, requestedSessionId);
                if (!targetSession) {
                  targetSession = await activateSession(
                    wsId,
                    requestedSessionId,
                    dataDir,
                    sessionOptions,
                  );
                }
              }

              if (!targetSession) {
                const active = getSession(wsId);
                if (active) {
                  targetSession = active;
                } else {
                  const result = await getOrCreateSession(wsId, dataDir, sessionOptions);
                  targetSession = result.session;
                }
              }

              attachSessionListeners(channel, targetSession);
              setSocketFocus(channel, socket, targetSession.sessionId);
              for (const state of channel.socketStates.values()) {
                if (!state.focusedSessionId) {
                  state.focusedSessionId = targetSession.sessionId;
                }
              }

              targetSession.sendMessage(incoming.content, incoming.options, incoming.images);
              sendToSession(channel, targetSession.sessionId, {
                type: "status",
                status: "busy",
                sessionId: targetSession.sessionId,
                streaming: true,
              });
            } catch (err: unknown) {
              sendOutgoing(socket, { type: "error", message: errorMessage(err, "Failed to send message") });
            }
            break;
          }
          case "stop": {
            try {
              const state = channel.socketStates.get(socket);
              const targetSessionId = incoming.sessionId ?? state?.focusedSessionId;
              if (targetSessionId) {
                stopStreaming(wsId, targetSessionId);
              } else {
                const active = getSession(wsId);
                if (!active) throw new Error(`No active session for workspace ${wsId}`);
                stopStreaming(wsId, active.sessionId);
              }
            } catch (err: unknown) {
              sendOutgoing(socket, { type: "error", message: errorMessage(err, "Failed to stop") });
            }
            break;
          }
          case "tool_input_response": {
            try {
              // Prefer routing dismiss responses back to the originating session.
              // This avoids races where active/focused session changed meanwhile.
              const requestSession = channel.pendingToolRequests.get(incoming.requestId);
              if (requestSession) {
                channel.pendingToolRequests.delete(incoming.requestId);
              }

              const sessionById = incoming.sessionId
                ? channel.sessionsById.get(incoming.sessionId) ?? getSessionById(wsId, incoming.sessionId)
                : undefined;

              let targetSession: ActiveSession | undefined;
              if (incoming.result.type === "dismiss") {
                targetSession = requestSession ?? sessionById;
              } else {
                targetSession = sessionById ?? requestSession;
              }

              if (!targetSession) {
                const state = channel.socketStates.get(socket);
                const focusedId = state?.focusedSessionId;
                if (focusedId) {
                  targetSession = channel.sessionsById.get(focusedId) ?? getSessionById(wsId, focusedId);
                  if (!targetSession) {
                    try {
                      targetSession = await activateSession(
                        wsId,
                        focusedId,
                        dataDir,
                        sessionOptions,
                      );
                    } catch {
                      // Fall through to active/create fallback.
                    }
                  }
                }
              }

              if (!targetSession) {
                let activeSession = getSession(wsId);
                if (!activeSession) {
                  const result = await getOrCreateSession(wsId, dataDir, sessionOptions);
                  activeSession = result.session;
                }
                targetSession = activeSession;
              }

              attachSessionListeners(channel, targetSession);
              setSocketFocus(channel, socket, targetSession.sessionId);
              targetSession.respondToToolInput(incoming.toolName, incoming.result);
              // Dismiss persists a message without spawning a CLI — no streaming.
              if (incoming.result.type !== "dismiss") {
                sendToSession(channel, targetSession.sessionId, {
                  type: "status",
                  status: "busy",
                  sessionId: targetSession.sessionId,
                  streaming: true,
                });
              }
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
