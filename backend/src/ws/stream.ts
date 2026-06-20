import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import {
  activateSession,
  getSession,
  getSessionById,
  getOrCreateSession,
  getStreamingSessionIds,
  stopStreaming,
} from "../agents/session-dispatch.js";
import type { SessionOptions } from "../agents/agent-manager.js";
import { errorMessage } from "../utils/errors.js";
import { isAuthorized } from "../utils/auth.js";
import type { WsIncoming, WsOutgoing, HubIncoming, HubOutgoing } from "../types.js";
import { getScriptStatus } from "../services/script-runner.js";
import { resolveChatCwd } from "../agents/chat-context.js";
import { getDataDir } from "../state/state.js";
import { browserSessionManager } from "../services/browser-session-manager.js";
import { resolve, sep } from "node:path";
import { replaceCompletionAliases, type CompletionProvider } from "../utils/completion-scanner.js";

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

type ActiveSession = NonNullable<ReturnType<typeof getSession>>;

// ── Hub socket tracking ─────────────────────────────────────────────

interface HubSocket {
  ws: WebSocket;
  subscribedWorkspaces: Set<string>;
  // Per-socket processing queue. Incoming messages from a single socket are
  // chained here so each is fully handled before the next begins. This keeps
  // e.g. sync_workspaces (which registers the subscription) from interleaving
  // with a following switch_session (which is rejected until subscribed).
  // Only same-socket ordering is serialized; different sockets run concurrently.
  queue: Promise<void>;
}

interface WorkspaceChannel {
  hubSockets: Set<HubSocket>;
  detachBySessionId: Map<string, () => void>;
  pendingToolRequests: Map<string, string>;
}

const PING_INTERVAL_MS = 30_000;

const channels = new Map<string, WorkspaceChannel>();
const hubSockets = new Set<HubSocket>();
const hubPingTimers = new Map<HubSocket, NodeJS.Timeout>();

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isWithinWorkspace(workspacePath: string, candidatePath: string): boolean {
  const root = resolve(workspacePath);
  const candidate = resolve(candidatePath);
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function replaceFileMentionsWithAbsolutePaths(
  content: string,
  mentions: Array<{ displayName: string; relativePath: string }>,
  workspacePath: string,
): string {
  let resolved = content;

  for (const mention of mentions) {
    if (!mention.displayName || !mention.relativePath) continue;

    const absPath = resolve(workspacePath, mention.relativePath);
    if (!isWithinWorkspace(workspacePath, absPath)) continue;

    const pattern = new RegExp(`(^|\\s)#${escapeRegExp(mention.displayName)}(?=\\s|$)`, "g");
    resolved = resolved.replace(pattern, `$1${absPath}`);
  }

  return resolved;
}

function completionProviderForMessage(
  modelId: string | undefined,
  lockedProvider: string | undefined,
): CompletionProvider | null {
  const provider = lockedProvider ?? modelId?.split(":")[0];
  return provider === "claude" || provider === "codex" ? provider : null;
}

// ── Sending helpers ─────────────────────────────────────────────────

function sendToHub(hub: HubSocket, workspaceId: string, msg: WsOutgoing): void {
  if (hub.ws.readyState === hub.ws.OPEN) {
    const envelope: HubOutgoing = { workspaceId, event: msg };
    hub.ws.send(JSON.stringify(envelope));
  }
}

/** Send a message to all hub sockets subscribed to a workspace channel. */
export function broadcastToWorkspace(workspaceId: string, msg: WsOutgoing): void {
  const channel = channels.get(workspaceId);
  if (!channel) return;
  const envelope: HubOutgoing = { workspaceId, event: msg };
  const serialized = JSON.stringify(envelope);
  for (const hub of channel.hubSockets) {
    if (hub.ws.readyState === hub.ws.OPEN) {
      hub.ws.send(serialized);
    }
  }
}

export function _getChannelsForTests(): Map<string, WorkspaceChannel> {
  return channels;
}

export function _getHubSocketsForTests(): Set<HubSocket> {
  return hubSockets;
}

// ── Route registration ──────────────────────────────────────────────

export async function streamRoutes(app: FastifyInstance, opts: StreamRoutesOptions = {}) {
  const {
    dataDir,
    sessionOptions,
    authToken,
    gitSyncSnapshotProvider,
  } = opts;

  const onBrowserStatus = (workspaceId: string, status: Extract<WsOutgoing, { type: "browser_status" }>["status"]) => {
    broadcastToWorkspace(workspaceId, { type: "browser_status", status });
  };
  browserSessionManager.on("status", onBrowserStatus);
  app.addHook("onClose", (_instance, done) => {
    browserSessionManager.removeListener("status", onBrowserStatus);
    done();
  });

  // ── Channel helpers ───────────────────────────────────────────────

  const getOrCreateChannel = (workspaceId: string): WorkspaceChannel => {
    const existing = channels.get(workspaceId);
    if (existing) return existing;
    const created: WorkspaceChannel = {
      hubSockets: new Set<HubSocket>(),
      detachBySessionId: new Map<string, () => void>(),
      pendingToolRequests: new Map<string, string>(),
    };
    channels.set(workspaceId, created);
    return created;
  };

  const broadcastToChannel = (channel: WorkspaceChannel, workspaceId: string, msg: WsOutgoing): void => {
    const envelope: HubOutgoing = { workspaceId, event: msg };
    const serialized = JSON.stringify(envelope);
    for (const hub of channel.hubSockets) {
      if (hub.ws.readyState === hub.ws.OPEN) {
        hub.ws.send(serialized);
      }
    }
  };

  // ── Session helpers (unchanged logic) ─────────────────────────────

  const sendSessionBootstrap = (hub: HubSocket, workspaceId: string, session: ActiveSession): void => {
    sendToHub(hub, workspaceId, {
      type: "status",
      status: session.status === "streaming" ? "busy" : "idle",
      sessionId: session.sessionId,
      streaming: session.status === "streaming",
      ...(session.status === "streaming" && session.streamingStartedAt
        ? { streamingStartedAt: session.streamingStartedAt }
        : {}),
      lockedProvider: session.metadata.lockedProvider,
    });

    // Live/history split (Option B): the WebSocket carries live state only.
    // History is fetched over REST. The in-flight turn is delivered as ONE
    // consolidated stream_snapshot with replace semantics, so late-connecting
    // clients see everything accumulated so far without any synthetic deltas.
    if (session.status === "streaming") {
      const snapshot = session.getStreamingSnapshot();
      if (snapshot) {
        sendToHub(hub, workspaceId, {
          type: "stream_snapshot",
          sessionId: session.sessionId,
          text: snapshot.text,
          thinking: snapshot.thinking,
          toolCalls: snapshot.toolCalls,
          agentActivities: snapshot.agentActivities,
          planMode: snapshot.agentPlanMode,
          streamingStartedAt: session.streamingStartedAt ?? Date.now(),
        });
      }
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
  };

  const detachAllSessionListeners = (channel: WorkspaceChannel): void => {
    for (const detach of channel.detachBySessionId.values()) {
      detach();
    }
    channel.detachBySessionId.clear();
    channel.pendingToolRequests.clear();
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
      if (msg.type === "tool_use") {
        browserSessionManager.maybeMarkToolActivity(workspaceId, session.sessionId, msg.name, msg.input);
      }
      broadcastToChannel(channel, workspaceId, msg);
    };
    const onError = (err: Error) => {
      broadcastToChannel(channel, workspaceId, { type: "error", message: err.message, sessionId: session.sessionId });
    };
    const onExit = (_code: number) => {
      broadcastToChannel(channel, workspaceId, {
        type: "status",
        status: "idle",
        sessionId: session.sessionId,
        streaming: false,
        lockedProvider: session.metadata.lockedProvider,
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

  // ── Workspace bootstrap (sent to one hub socket on subscribe) ─────

  const sendWorkspaceBootstrap = async (hub: HubSocket, wsId: string, channel: WorkspaceChannel): Promise<void> => {
    const session = getSession(wsId);

    if (session) {
      attachSessionListeners(wsId, channel, session);
      sendSessionBootstrap(hub, wsId, session);
      for (const streamingId of getStreamingSessionIds(wsId)) {
        if (streamingId !== session.sessionId) {
          const streamingSession = getSessionById(wsId, streamingId);
          sendToHub(hub, wsId, {
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
      // No active session: report idle status only. Message history is owned by
      // REST under the live/history split; the WebSocket no longer sends it.
      sendToHub(hub, wsId, { type: "status", status: "idle", streaming: false });
    }

    const branchInfo = gitSyncSnapshotProvider?.getCachedBranchInfo(wsId);
    if (branchInfo) {
      sendToHub(hub, wsId, { type: "branch_info", info: branchInfo });
    }

    const diffStats = gitSyncSnapshotProvider?.getCachedDiffStats(wsId);
    if (diffStats) {
      sendToHub(hub, wsId, { type: "diff_stats", stats: diffStats });
    }

    const scriptStatus = getScriptStatus(wsId);
    for (const [scriptType, info] of Object.entries(scriptStatus)) {
      if (info.state !== "idle") {
        sendToHub(hub, wsId, {
          type: "script_status",
          scriptType,
          state: info.state,
          ...(info.exitCode !== undefined ? { exitCode: info.exitCode } : {}),
        });
      }
    }

    for (const status of browserSessionManager.getVisibleStatuses(wsId)) {
      sendToHub(hub, wsId, { type: "browser_status", status });
    }
  };

  // ── sync_workspaces handler ───────────────────────────────────────

  const handleSyncWorkspaces = async (hub: HubSocket, workspaceIds: string[]): Promise<void> => {
    const desired = new Set(workspaceIds);

    // Unsubscribe from removed workspaces
    for (const wsId of hub.subscribedWorkspaces) {
      if (!desired.has(wsId)) {
        const channel = channels.get(wsId);
        if (channel) {
          channel.hubSockets.delete(hub);
          if (channel.hubSockets.size === 0) {
            detachAllSessionListeners(channel);
            channels.delete(wsId);
          }
        }
      }
    }

    // Subscribe to new workspaces and bootstrap.
    // The hub socket is added to the channel AFTER bootstrap completes so that
    // live deltas broadcast while bootstrap runs cannot reach this client before
    // the consolidated stream_snapshot does (which would let a delta land ahead
    // of the snapshot that replaces the stream state). Node.js single-threading
    // guarantees no events fire between sendWorkspaceBootstrap returning and
    // hubSockets.add.
    for (const wsId of desired) {
      if (!hub.subscribedWorkspaces.has(wsId)) {
        const channel = getOrCreateChannel(wsId);
        await sendWorkspaceBootstrap(hub, wsId, channel);
        channel.hubSockets.add(hub);
      }
    }

    hub.subscribedWorkspaces = desired;
  };

  // ── Workspace message handler ─────────────────────────────────────

  const handleWorkspaceMessage = async (hub: HubSocket, wsId: string, incoming: WsIncoming): Promise<void> => {
    const channel = channels.get(wsId);
    if (!channel || !channel.hubSockets.has(hub)) {
      sendToHub(hub, wsId, { type: "error", message: `Not subscribed to workspace ${wsId}` });
      return;
    }

    switch (incoming.type) {
      case "switch_session": {
        // Focus pull. With an explicit sessionId the client switches to that
        // session (activating it if needed). With no sessionId it is a pull on
        // the workspace's active session — used on first focus / reconnect when
        // the client has no session id yet. Either way the response is just
        // status + (when streaming) a consolidated stream_snapshot; replace
        // semantics make repeated pulls idempotent.
        if (incoming.sessionId === undefined) {
          const session = getSession(wsId);
          if (session) {
            attachSessionListeners(wsId, channel, session);
            sendSessionBootstrap(hub, wsId, session);
          } else {
            sendToHub(hub, wsId, { type: "status", status: "idle", streaming: false });
          }
          break;
        }
        try {
          const session = await activateSession(
            wsId,
            incoming.sessionId,
            dataDir,
            sessionOptions,
          );
          attachSessionListeners(wsId, channel, session);
          sendSessionBootstrap(hub, wsId, session);
        } catch (err: unknown) {
          sendToHub(hub, wsId, { type: "error", message: errorMessage(err, "Failed to switch session") });
        }
        break;
      }
      case "user_message": {
        try {
          let targetSession: ActiveSession | undefined;
          if (incoming.sessionId) {
            targetSession = await resolveSessionById(wsId, channel, incoming.sessionId);
            if (!targetSession) {
              throw new Error(`Session ${incoming.sessionId} not found`);
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

          // Build cliContent by replacing Hive-only symbols with provider-native text.
          let cliContent: string | undefined;
          const completionProvider = completionProviderForMessage(
            incoming.options?.model,
            targetSession.metadata.lockedProvider,
          );
          const shouldResolveCompletionAliases =
            (completionProvider === "codex" && incoming.content.includes("/")) ||
            (completionProvider === "claude" && incoming.content.includes("@"));
          if (incoming.fileMentions?.length || shouldResolveCompletionAliases) {
            const dir = dataDir ?? getDataDir();
            const wsPath = await resolveChatCwd(wsId, dir);
            if (wsPath) {
              let resolvedContent = incoming.content;
              if (incoming.fileMentions?.length) {
                resolvedContent = replaceFileMentionsWithAbsolutePaths(resolvedContent, incoming.fileMentions, wsPath);
              }
              if (shouldResolveCompletionAliases) {
                resolvedContent = await replaceCompletionAliases(resolvedContent, wsPath, completionProvider);
              }
              if (resolvedContent !== incoming.content) {
                cliContent = resolvedContent;
              }
            }
          }

          targetSession.sendMessage(incoming.content, incoming.options, incoming.images, cliContent, incoming.fileMentions);
          broadcastToChannel(channel, wsId, {
            type: "status",
            status: "busy",
            sessionId: targetSession.sessionId,
            streaming: true,
            streamingStartedAt: targetSession.streamingStartedAt ?? undefined,
            lockedProvider: targetSession.metadata.lockedProvider,
          });
        } catch (err: unknown) {
          sendToHub(hub, wsId, { type: "error", message: errorMessage(err, "Failed to send message") });
        }
        break;
      }
      case "stop": {
        try {
          const targetSessionId = incoming.sessionId;
          if (targetSessionId) {
            stopStreaming(wsId, targetSessionId);
          } else {
            const active = getSession(wsId);
            if (!active) throw new Error(`No active session for workspace ${wsId}`);
            stopStreaming(wsId, active.sessionId);
          }
        } catch (err: unknown) {
          sendToHub(hub, wsId, { type: "error", message: errorMessage(err, "Failed to stop") });
        }
        break;
      }
      case "tool_input_response": {
        try {
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
            let activeSession = getSession(wsId);
            if (!activeSession) {
              const result = await getOrCreateSession(wsId, dataDir, sessionOptions);
              activeSession = result.session;
            }
            targetSession = activeSession;
          }

          attachSessionListeners(wsId, channel, targetSession);
          targetSession.respondToToolInput(incoming.toolName, incoming.result);
          // Tell every client (answers and dismissals alike) that the pending
          // question is gone, so stale question panels/toasts clear everywhere.
          broadcastToChannel(channel, wsId, {
            type: "tool_input_resolved",
            sessionId: targetSession.sessionId,
          });
          if (incoming.result.type !== "dismiss") {
            broadcastToChannel(channel, wsId, {
              type: "status",
              status: "busy",
              sessionId: targetSession.sessionId,
              streaming: true,
              streamingStartedAt: targetSession.streamingStartedAt ?? undefined,
            });
          }
        } catch (err: unknown) {
          sendToHub(hub, wsId, { type: "error", message: errorMessage(err, "Failed to respond to tool input") });
        }
        break;
      }
    }
  };

  // ── Hub WebSocket endpoint ────────────────────────────────────────

  app.get<{ Querystring: { token?: string } }>(
    "/ws/hub",
    { websocket: true },
    async (socket, req) => {
      const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
      if (!isAuthorized(req.headers, authToken, queryToken)) {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ workspaceId: "_auth", event: { type: "error", message: "Unauthorized" } }));
        }
        socket.close(1008, "Unauthorized");
        return;
      }

      const hub: HubSocket = { ws: socket, subscribedWorkspaces: new Set(), queue: Promise.resolve() };
      hubSockets.add(hub);

      const pingTimer = setInterval(() => {
        if (socket.readyState === socket.OPEN) socket.ping();
      }, PING_INTERVAL_MS);
      hubPingTimers.set(hub, pingTimer);

      socket.on("close", () => {
        const timer = hubPingTimers.get(hub);
        if (timer) { clearInterval(timer); hubPingTimers.delete(hub); }

        // Unsubscribe from all workspace channels
        for (const wsId of hub.subscribedWorkspaces) {
          const channel = channels.get(wsId);
          if (channel) {
            channel.hubSockets.delete(hub);
            if (channel.hubSockets.size === 0) {
              detachAllSessionListeners(channel);
              channels.delete(wsId);
            }
          }
        }
        hubSockets.delete(hub);
      });

      socket.on("message", (raw) => {
        let parsed: HubIncoming;
        try {
          parsed = JSON.parse(raw.toString()) as HubIncoming;
        } catch {
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify({ workspaceId: "_error", event: { type: "error", message: "Invalid JSON" } }));
          }
          return;
        }

        // Serialize per-socket handling: each message is fully processed before
        // the next from the same socket begins, preventing sync_workspaces from
        // interleaving with a following switch_session. Failures are isolated so
        // one rejected message does not break the chain for subsequent ones.
        hub.queue = hub.queue.then(async () => {
          if ("type" in parsed && parsed.type === "sync_workspaces") {
            await handleSyncWorkspaces(hub, parsed.workspaceIds);
          } else if ("workspaceId" in parsed && "event" in parsed) {
            await handleWorkspaceMessage(hub, parsed.workspaceId, parsed.event);
          }
        }).catch(() => {});
      });
    },
  );
}
