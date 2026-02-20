import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import {
  activateSession,
  getSession,
  getSessionById,
  getOrCreateSession,
  getSessionMessages,
  getStreamingSessionIds,
  stopStreaming,
  type SessionOptions,
} from "../agents/agent-manager.js";
import { errorMessage } from "../utils/errors.js";
import { isAuthorized } from "../utils/auth.js";
import type { WsIncoming, WsOutgoing } from "../types.js";
import { getScriptStatus } from "../services/script-runner.js";

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
  pendingToolRequests: Map<string, string>;
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
      pendingToolRequests: new Map<string, string>(),
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
      status: session.status === "streaming" ? "busy" : "idle",
      sessionId: session.sessionId,
      streaming: session.status === "streaming",
      ...(session.status === "streaming" && session.streamingStartedAt
        ? { streamingStartedAt: session.streamingStartedAt }
        : {}),
    });
    try {
      const messages = await session.getMessages();
      sendOutgoing(socket, { type: "history", sessionId: session.sessionId, messages });
    } catch {
      // History load failure is non-fatal.
    }
  };

  const detachSessionTracking = (channel: WorkspaceChannel, sessionId: string): void => {
    const detach = channel.detachBySessionId.get(sessionId);
    if (detach) {
      detach();
      channel.detachBySessionId.delete(sessionId);
    }
    for (const [requestId, pendingSessionId] of channel.pendingToolRequests) {
      if (pendingSessionId === sessionId) {
        channel.pendingToolRequests.delete(requestId);
      }
    }
    for (const state of channel.socketStates.values()) {
      if (state.focusedSessionId === sessionId) {
        state.focusedSessionId = undefined;
      }
    }
  };

  const detachAllSessionListeners = (channel: WorkspaceChannel): void => {
    for (const detach of channel.detachBySessionId.values()) {
      detach();
    }
    channel.detachBySessionId.clear();
    channel.pendingToolRequests.clear();
  };

  const broadcastStatusToChannel = (
    channel: WorkspaceChannel,
    msg: Extract<WsOutgoing, { type: "status" }>,
  ): void => {
    for (const socket of channel.sockets) {
      sendOutgoing(socket, msg);
    }
  };

  const attachSessionListeners = (
    workspaceId: string,
    channel: WorkspaceChannel,
    session: ActiveSession,
  ): void => {
    if (channel.detachBySessionId.has(session.sessionId)) {
      return;
    }

    const onMessage = (msg: WsOutgoing) => {
      if (msg.type === "tool_input_required") {
        channel.pendingToolRequests.set(msg.requestId, session.sessionId);
      }
      sendToSession(channel, session.sessionId, msg);
      // Broadcast streaming-stopped to ALL sockets so non-focused clients
      // can update per-session streaming state.
      if (msg.type === "done" || msg.type === "cancelled") {
        broadcastStatusToChannel(channel, {
          type: "status",
          status: "idle",
          sessionId: session.sessionId,
          streaming: false,
        });
      }
    };
    const onError = (err: Error) => {
      sendToSession(channel, session.sessionId, { type: "error", message: err.message });
    };
    const onExit = (_code: number) => {
      // Always broadcast idle status so all clients clear streaming state,
      // even if the session was already removed from memory (e.g. deletion).
      broadcastStatusToChannel(channel, {
        type: "status",
        status: "idle",
        sessionId: session.sessionId,
        streaming: false,
      });
      const live = getSessionById(workspaceId, session.sessionId);
      if (!live) {
        detachSessionTracking(channel, session.sessionId);
      }
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

  const resolveSessionById = async (
    workspaceId: string,
    channel: WorkspaceChannel,
    sessionId: string,
  ): Promise<ActiveSession | undefined> => {
    const loaded = getSessionById(workspaceId, sessionId);
    if (loaded) return loaded;
    detachSessionTracking(channel, sessionId);
    try {
      const activated = await activateSession(
        workspaceId,
        sessionId,
        dataDir,
        sessionOptions,
      );
      attachSessionListeners(workspaceId, channel, activated);
      return activated;
    } catch {
      return undefined;
    }
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
        attachSessionListeners(wsId, channel, session);
        setSocketFocus(channel, socket, session.sessionId);
        await sendSessionBootstrap(socket, session);
        // Send status for other sessions that are currently streaming
        for (const streamingId of getStreamingSessionIds(wsId)) {
          if (streamingId !== session.sessionId) {
            const streamingSession = getSessionById(wsId, streamingId);
            sendOutgoing(socket, {
              type: "status",
              status: "busy",
              sessionId: streamingId,
              streaming: true,
              ...(streamingSession?.streamingStartedAt
                ? { streamingStartedAt: streamingSession.streamingStartedAt }
                : {}),
            });
          }
        }
      } else {
        sendOutgoing(socket, { type: "status", status: "idle", streaming: false });
        try {
          const messages = await getSessionMessages(wsId, dataDir);
          if (messages.length > 0) {
            const firstSessionId = messages[0]?.sessionId;
            if (firstSessionId) {
              setSocketFocus(channel, socket, firstSessionId);
            }
            sendOutgoing(socket, { type: "history", sessionId: firstSessionId, messages });
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

      // Bootstrap script running state so sidebar indicators survive reconnects.
      const scriptStatus = getScriptStatus(wsId);
      for (const [scriptType, info] of Object.entries(scriptStatus)) {
        if (info.state !== "idle") {
          sendOutgoing(socket, {
            type: "script_status",
            scriptType,
            state: info.state,
            ...(info.exitCode !== undefined ? { exitCode: info.exitCode } : {}),
          });
        }
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
            const state = channel.socketStates.get(socket);
            const previousFocusSessionId = state?.focusedSessionId;
            if (state) {
              // Prevent stale events from the previous session while switch is in-flight.
              state.focusedSessionId = incoming.sessionId;
            }
            try {
              const session = await activateSession(
                wsId,
                incoming.sessionId,
                dataDir,
                sessionOptions,
              );
              attachSessionListeners(wsId, channel, session);
              setSocketFocus(channel, socket, session.sessionId);
              await sendSessionBootstrap(socket, session);
            } catch (err: unknown) {
              if (state) {
                state.focusedSessionId = previousFocusSessionId;
              }
              sendOutgoing(socket, { type: "error", message: errorMessage(err, "Failed to switch session") });
            }
            break;
          }
          case "user_message": {
            try {
              const state = channel.socketStates.get(socket);
              const explicitSessionRequested = typeof incoming.sessionId === "string";
              const requestedSessionId = incoming.sessionId ?? state?.focusedSessionId;

              let targetSession: ActiveSession | undefined;
              if (requestedSessionId) {
                targetSession = await resolveSessionById(wsId, channel, requestedSessionId);
                if (!targetSession && explicitSessionRequested) {
                  throw new Error(`Session ${requestedSessionId} not found`);
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

              attachSessionListeners(wsId, channel, targetSession);
              setSocketFocus(channel, socket, targetSession.sessionId);
              for (const state of channel.socketStates.values()) {
                if (!state.focusedSessionId) {
                  state.focusedSessionId = targetSession.sessionId;
                }
              }

              targetSession.sendMessage(incoming.content, incoming.options, incoming.images);
              broadcastStatusToChannel(channel, {
                type: "status",
                status: "busy",
                sessionId: targetSession.sessionId,
                streaming: true,
                streamingStartedAt: targetSession.streamingStartedAt ?? undefined,
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
              const requestSessionId = channel.pendingToolRequests.get(incoming.requestId);
              if (requestSessionId) {
                channel.pendingToolRequests.delete(incoming.requestId);
              }

              const sessionById = incoming.sessionId
                ? await resolveSessionById(wsId, channel, incoming.sessionId)
                : undefined;
              const requestSession = requestSessionId
                ? await resolveSessionById(wsId, channel, requestSessionId)
                : undefined;

              if (incoming.sessionId && !sessionById && !requestSession) {
                throw new Error(`Session ${incoming.sessionId} not found`);
              }

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
                  targetSession = await resolveSessionById(wsId, channel, focusedId);
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

              attachSessionListeners(wsId, channel, targetSession);
              setSocketFocus(channel, socket, targetSession.sessionId);
              targetSession.respondToToolInput(incoming.toolName, incoming.result);
              // Dismiss persists a message without spawning a CLI — no streaming.
              if (incoming.result.type !== "dismiss") {
                broadcastStatusToChannel(channel, {
                  type: "status",
                  status: "busy",
                  sessionId: targetSession.sessionId,
                  streaming: true,
                  streamingStartedAt: targetSession.streamingStartedAt ?? undefined,
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
