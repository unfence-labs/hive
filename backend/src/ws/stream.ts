import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import {
  activateSession,
  getSession,
  getSessionById,
  getOrCreateSession,
  getDefaultSessionId,
  getStreamingSessionIds,
  isLoadedDefaultSessionCandidate,
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

interface PrStatusProvider {
  getCachedStatus: (workspaceId: string) => Extract<WsOutgoing, { type: "pr_status" }>["status"] | undefined;
  getStatus: (workspaceId: string) => Promise<Extract<WsOutgoing, { type: "pr_status" }>["status"]>;
}

export interface StreamRoutesOptions {
  dataDir?: string;
  sessionOptions?: SessionOptions;
  authToken?: string;
  gitSyncSnapshotProvider?: GitSyncSnapshotProvider;
  prStatusProvider?: PrStatusProvider;
}

type ActiveSession = NonNullable<ReturnType<typeof getSession>>;

// ── Hub socket tracking ─────────────────────────────────────────────

interface HubSocket {
  ws: WebSocket;
  subscribedWorkspaces: Set<string>;
  /** WS-level heartbeat flag: set true on `pong`, cleared each ping tick. A missed cycle reaps the socket. */
  isAlive: boolean;
  focusWorkspaces?: Set<string>;
  prWorkspaces: Set<string>;
}

const HIGH_FREQUENCY_EVENTS: ReadonlySet<WsOutgoing["type"]> = new Set([
  "text_delta",
  "thinking",
  "tool_use",
  "tool_result",
  "agent_activity",
  "stream_snapshot",
]);

function hubReceivesEvent(hub: HubSocket, workspaceId: string, msg: WsOutgoing): boolean {
  if (msg.type === "pr_status") return hub.prWorkspaces.has(workspaceId);
  if (!hub.focusWorkspaces) return true;
  if (!HIGH_FREQUENCY_EVENTS.has(msg.type)) return true;
  return hub.focusWorkspaces.has(workspaceId);
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
  if (hub.ws.readyState === hub.ws.OPEN && hubReceivesEvent(hub, workspaceId, msg)) {
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
    if (hub.ws.readyState === hub.ws.OPEN && hubReceivesEvent(hub, workspaceId, msg)) {
      hub.ws.send(serialized);
    }
  }
}

/**
 * WS-level heartbeat tick (canonical `ws` pattern). A peer that missed the
 * previous cycle (`isAlive` still false) is terminated; `terminate()` emits
 * `close`, which runs the existing cleanup. Otherwise arm the next cycle by
 * clearing the flag and pinging so the client's `pong` can re-set it.
 */
function tickHubLiveness(hub: HubSocket): void {
  if (!hub.isAlive) {
    hub.ws.terminate();
    return;
  }
  hub.isAlive = false;
  if (hub.ws.readyState === hub.ws.OPEN) hub.ws.ping();
}

export function hasPrStatusInterest(workspaceId: string): boolean {
  for (const hub of hubSockets) {
    if (hub.subscribedWorkspaces.has(workspaceId) && hub.prWorkspaces.has(workspaceId)) {
      return true;
    }
  }
  return false;
}

export function _getChannelsForTests(): Map<string, WorkspaceChannel> {
  return channels;
}

export function _getHubSocketsForTests(): Set<HubSocket> {
  return hubSockets;
}

export function _tickHubLivenessForTests(hub: HubSocket): void {
  tickHubLiveness(hub);
}

// ── Route registration ──────────────────────────────────────────────

export async function streamRoutes(app: FastifyInstance, opts: StreamRoutesOptions = {}) {
  const {
    dataDir,
    sessionOptions,
    authToken,
    gitSyncSnapshotProvider,
    prStatusProvider,
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
      if (hub.ws.readyState === hub.ws.OPEN && hubReceivesEvent(hub, workspaceId, msg)) {
        hub.ws.send(serialized);
      }
    }
  };

  // ── Session helpers (unchanged logic) ─────────────────────────────

  const sendSessionBootstrap = async (hub: HubSocket, workspaceId: string, session: ActiveSession): Promise<void> => {
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

    // Replay in-progress streaming content so late-connecting clients see
    // text, thinking, and tool calls accumulated since the turn started.
    sendStreamingSnapshot(hub, workspaceId, session);
  };

  const sendStreamingSnapshot = (hub: HubSocket, workspaceId: string, session: ActiveSession): void => {
    if (session.status !== "streaming") return;
    const snapshot = session.getStreamingSnapshot();
    if (!snapshot) return;
    sendToHub(hub, workspaceId, {
      type: "stream_snapshot",
      sessionId: session.sessionId,
      text: snapshot.text,
      thinking: snapshot.thinking,
      toolCalls: snapshot.toolCalls,
      agentActivities: snapshot.agentActivities,
      agentPlanMode: snapshot.agentPlanMode,
      ...(session.streamingStartedAt ? { streamingStartedAt: session.streamingStartedAt } : {}),
    });
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
    const sendStreamingBootstraps = (primarySessionId?: string): void => {
      for (const streamingId of getStreamingSessionIds(wsId)) {
        if (streamingId === primarySessionId) continue;
        const streamingSession = getSessionById(wsId, streamingId);
        if (streamingSession) {
          attachSessionListeners(wsId, channel, streamingSession);
        }
        sendToHub(hub, wsId, {
          type: "status",
          status: "busy",
          sessionId: streamingId,
          streaming: true,
          ...(streamingSession?.streamingStartedAt
            ? { streamingStartedAt: streamingSession.streamingStartedAt }
            : {}),
        });
        if (streamingSession) {
          sendStreamingSnapshot(hub, wsId, streamingSession);
        }
      }
    };

    const session = getSession(wsId);
    const sessionIsDefaultCandidate = session
      ? isLoadedDefaultSessionCandidate(wsId, session)
      : false;
    const defaultSessionId = !session || !sessionIsDefaultCandidate
      ? await getDefaultSessionId(wsId, dataDir).catch(() => undefined)
      : undefined;

    if (session && (sessionIsDefaultCandidate || !defaultSessionId)) {
      attachSessionListeners(wsId, channel, session);
      await sendSessionBootstrap(hub, wsId, session);
      sendStreamingBootstraps(session.sessionId);
    } else {
      // The in-memory active session is empty/idle, so we steer a fresh client
      // to a different default chat. Still attach the active chat session's
      // listeners: a client that stays on it (instead of adopting the redirect)
      // must keep receiving its live events, as it did before this redirect.
      if (session && session.metadata.kind !== "terminal") {
        attachSessionListeners(wsId, channel, session);
      }

      const defaultSession = defaultSessionId ? getSessionById(wsId, defaultSessionId) : undefined;
      if (defaultSession) {
        // The default chat is already loaded: bootstrap it as the primary
        // session so its listeners are attached and its real status/snapshot are
        // sent — a streaming default must not be announced as idle first.
        attachSessionListeners(wsId, channel, defaultSession);
        await sendSessionBootstrap(hub, wsId, defaultSession);
        sendStreamingBootstraps(defaultSession.sessionId);
      } else {
        // No default-worthy chat is loaded in memory. Tell the client which
        // session to open (persisted active / most-recent non-empty chat) so a
        // first visit lands on real history instead of a blank "new conversation"
        // — resolved from metadata only, without shipping history over the WS.
        sendToHub(hub, wsId, {
          type: "status",
          status: "idle",
          streaming: false,
          ...(defaultSessionId ? { sessionId: defaultSessionId } : {}),
        });
        sendStreamingBootstraps();
      }
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

  const sendWorkspacePrStatus = async (hub: HubSocket, wsId: string): Promise<void> => {
    if (!hub.prWorkspaces.has(wsId) || !prStatusProvider) return;
    try {
      const status = await prStatusProvider.getStatus(wsId);
      sendToHub(hub, wsId, { type: "pr_status", status });
    } catch (err) {
      app.log.warn({ err, wsId }, "Failed to refresh PR status for hub client");
      sendToHub(hub, wsId, {
        type: "pr_status",
        status: { pr: null, error: "Failed to fetch PR status" },
      });
    }
  };

  // ── sync_workspaces handler ───────────────────────────────────────

  const handleSyncWorkspaces = async (
    hub: HubSocket,
    workspaceIds: string[],
    focusWorkspaces?: string[],
    prWorkspaces?: string[],
    forceBootstrap?: boolean,
  ): Promise<void> => {
    const desired = new Set(workspaceIds);
    const previouslySubscribed = new Set(hub.subscribedWorkspaces);
    const previousFocusWorkspaces = hub.focusWorkspaces;
    const previousPrWorkspaces = hub.prWorkspaces;
    hub.focusWorkspaces = focusWorkspaces ? new Set(focusWorkspaces) : undefined;
    hub.prWorkspaces = new Set(prWorkspaces ?? []);

    // A forced refresh resends full bootstrap below, which already covers the
    // streaming snapshot replay -- skip the focus-only replay here to avoid
    // sending the snapshot twice.
    if (hub.focusWorkspaces && !forceBootstrap) {
      for (const wsId of hub.focusWorkspaces) {
        if (previousFocusWorkspaces?.has(wsId)) continue;
        if (!hub.subscribedWorkspaces.has(wsId)) continue;
        for (const streamingId of getStreamingSessionIds(wsId)) {
          const session = getSessionById(wsId, streamingId);
          if (session) sendStreamingSnapshot(hub, wsId, session);
        }
      }
    }

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

    // Subscribe to new workspaces and bootstrap. Subscription intent is recorded
    // synchronously (the channel is created now and hub.subscribedWorkspaces is
    // updated below, both before the first bootstrap `await`) so that a workspace
    // message racing the async bootstrap on this same socket is authorized rather
    // than rejected as "Not subscribed".
    //
    // The hub socket is added to channel.hubSockets only AFTER each bootstrap
    // completes so that live events broadcast during the async bootstrap don't
    // reach this client before its streaming snapshot is replayed (which would
    // cause duplicate content).
    const newlySubscribed: Array<[string, WorkspaceChannel]> = [];
    for (const wsId of desired) {
      if (!hub.subscribedWorkspaces.has(wsId)) {
        newlySubscribed.push([wsId, getOrCreateChannel(wsId)]);
      }
    }

    hub.subscribedWorkspaces = desired;

    for (const [wsId, channel] of newlySubscribed) {
      await sendWorkspaceBootstrap(hub, wsId, channel);
      channel.hubSockets.add(hub);
    }

    // Resend full bootstrap for workspaces the client was already subscribed
    // to (e.g. iOS foreground refresh over a healthy socket). Newly subscribed
    // workspaces above already got a fresh bootstrap, so skip those to avoid
    // duplicate delivery.
    if (forceBootstrap) {
      for (const wsId of desired) {
        if (!previouslySubscribed.has(wsId)) continue;
        const channel = channels.get(wsId);
        if (channel) await sendWorkspaceBootstrap(hub, wsId, channel);
      }
    }

    const prRefreshes = [...hub.prWorkspaces]
      .filter((wsId) =>
        desired.has(wsId) &&
        (forceBootstrap || !previousPrWorkspaces.has(wsId))
      )
      .map((wsId) => sendWorkspacePrStatus(hub, wsId));
    await Promise.all(prRefreshes);
  };

  // ── Workspace message handler ─────────────────────────────────────

  const handleWorkspaceMessage = async (hub: HubSocket, wsId: string, incoming: WsIncoming): Promise<void> => {
    const channel = channels.get(wsId);
    if (!channel || !hub.subscribedWorkspaces.has(wsId)) {
      sendToHub(hub, wsId, { type: "error", message: `Not subscribed to workspace ${wsId}` });
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
          attachSessionListeners(wsId, channel, session);
          await sendSessionBootstrap(hub, wsId, session);
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

      // Start alive so the socket gets a full cycle before it can be reaped.
      const hub: HubSocket = {
        ws: socket,
        subscribedWorkspaces: new Set(),
        isAlive: true,
        prWorkspaces: new Set(),
      };
      hubSockets.add(hub);

      socket.on("pong", () => { hub.isAlive = true; });

      const pingTimer = setInterval(() => tickHubLiveness(hub), PING_INTERVAL_MS);
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

      socket.on("message", async (raw) => {
        let parsed: HubIncoming;
        try {
          parsed = JSON.parse(raw.toString()) as HubIncoming;
        } catch {
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify({ workspaceId: "_error", event: { type: "error", message: "Invalid JSON" } }));
          }
          return;
        }

        if ("type" in parsed && parsed.type === "ping") {
          // Application-level liveness probe: reply immediately so the client
          // can distinguish a healthy idle socket from a frozen one.
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify({ type: "pong" }));
          }
        } else if ("type" in parsed && parsed.type === "sync_workspaces") {
          try {
            await handleSyncWorkspaces(
              hub,
              parsed.workspaceIds,
              parsed.focusWorkspaces,
              parsed.prWorkspaces,
              parsed.forceBootstrap === true,
            );
          } catch (err) {
            app.log.error({ err }, "sync_workspaces handler failed");
          }
        } else if ("workspaceId" in parsed && "event" in parsed) {
          await handleWorkspaceMessage(hub, parsed.workspaceId, parsed.event);
        }
      });
    },
  );
}
