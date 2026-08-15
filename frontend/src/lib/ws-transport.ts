import { getAuthToken, getServerUrl } from "@/hooks/useConnection";
import type { WsIncoming, WsOutgoing, HubIncoming, HubOutgoing } from "@/types";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

type MessageHandler = (msg: WsOutgoing) => void;
type GlobalMessageHandler = (workspaceId: string, msg: WsOutgoing) => void;
type StatusListener = () => void;
type StatusMessage = Extract<WsOutgoing, { type: "status" }>;
type DiffStatsMessage = Extract<WsOutgoing, { type: "diff_stats" }>;
type BranchInfoMessage = Extract<WsOutgoing, { type: "branch_info" }>;

const MAX_RECONNECT_DELAY = 30_000;
const BASE_RECONNECT_DELAY = 1_000;
// Application-level heartbeat. The browser WebSocket API never surfaces
// protocol ping/pong to JS, so a frozen-but-OPEN socket (after OS sleep/wake or
// a network change) is invisible to onclose. We send our own `ping` and watch
// for the matching `pong` to detect liveness.
const HEARTBEAT_INTERVAL_MS = 25_000;
const PONG_TIMEOUT_MS = 10_000;
// On window focus / tab visibility / network regain, probe the socket and only
// reconnect if the probe goes unanswered within this window. Active probing (vs.
// "reconnect any silent socket") is what avoids reconnecting healthy idle sockets.
const FOCUS_PROBE_TIMEOUT_MS = 3_000;

/** Narrowed hub envelope carrying a workspace event (the non-pong variant). */
type WorkspaceEnvelope = { workspaceId: string; event: WsOutgoing };

interface PendingFullResync {
  requestId: string;
  resolve: () => void;
  reject: (reason: Error) => void;
  signal?: AbortSignal;
  abortListener?: () => void;
}

// ── Hub socket state ────────────────────────────────────────────────

interface HubState {
  ws: WebSocket | null;
  status: ConnectionStatus;
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  /** Timestamp of the last `pong` received (liveness signal). */
  lastPongAt: number;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
}

// ── Per-workspace subscription data (no socket) ─────────────────────

interface WorkspaceSubscription {
  messageHandlers: Set<MessageHandler>;
  reconnectListeners: Set<() => void>;
  statusListeners: Set<StatusListener>;
  lastStatus?: StatusMessage;
  lastStatusBySession: Map<string, StatusMessage>;
  lastDiffStats?: DiffStatsMessage;
  lastBranchInfo?: BranchInfoMessage;
  /** Messages received while no handler was subscribed. Replayed on next onMessage(). */
  messageBuffer: WsOutgoing[];
}

class WsTransport {
  private hub: HubState = {
    ws: null,
    status: "disconnected",
    reconnectAttempt: 0,
    reconnectTimer: null,
    lastPongAt: 0,
    heartbeatTimer: null,
  };
  private subscriptions = new Map<string, WorkspaceSubscription>();
  private subscribedWorkspaceIds = new Set<string>();
  private prWorkspaceIds = new Set<string>();
  private globalListeners = new Set<GlobalMessageHandler>();
  private pendingFullResync: PendingFullResync | null = null;
  private nextSyncRequestId = 0;

  /** Connect to a workspace (subscribes it via the hub). */
  connect(workspaceId: string): void {
    this.getOrCreateSubscription(workspaceId);
    if (!this.subscribedWorkspaceIds.has(workspaceId)) {
      this.subscribedWorkspaceIds.add(workspaceId);
      this.ensureHubConnected();
      this.sendSyncWorkspaces();
    }
  }

  /** Ensure exactly this set of workspaces are subscribed via the hub. */
  syncWorkspaces(workspaceIds: string[]): void {
    const wanted = new Set(workspaceIds);
    for (const workspaceId of wanted) {
      this.getOrCreateSubscription(workspaceId);
    }
    // Remove unwanted (if no listeners remain)
    for (const workspaceId of Array.from(this.subscriptions.keys())) {
      if (!wanted.has(workspaceId)) {
        const sub = this.subscriptions.get(workspaceId);
        if (sub && (sub.messageHandlers.size > 0 || sub.statusListeners.size > 0)) {
          continue;
        }
        this.subscriptions.delete(workspaceId);
      }
    }
    this.subscribedWorkspaceIds = wanted;
    this.ensureHubConnected();
    this.sendSyncWorkspaces();
  }

  /**
   * Ask the backend to replay the live status + in-progress stream snapshots
   * of currently streaming sessions for a single workspace.
   *
   * Stream frames that arrive while a workspace's conversation view is
   * unmounted are consumed by the app-level cache hooks (which keep
   * `messageHandlers` non-empty, so nothing is buffered) and are gone for the
   * chat UI. A conversation view that mounts mid-stream must therefore ask for
   * the snapshot replay explicitly, scoped to just the workspace it opened —
   * unlike iOS foreground `forceBootstrap`, this must not refresh every
   * subscribed workspace. No-op when the socket is not open: a (re)connecting
   * socket gets the full bootstrap from the backend anyway.
   */
  requestStreamSnapshots(workspaceId: string): void {
    this.send(workspaceId, { type: "request_stream_snapshots" });
  }

  /**
   * Replace the hub socket and replay every subscribed workspace bootstrap.
   * The promise resolves only after the backend confirms that the serialized
   * bootstrap finished on the fresh connection.
   */
  requestFullResync(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(this.abortReason(signal));
    }
    if (this.pendingFullResync) {
      return Promise.reject(new Error("A full resync is already in progress"));
    }
    for (const sub of this.subscriptions.values()) {
      sub.lastStatus = undefined;
      sub.lastStatusBySession.clear();
      sub.lastDiffStats = undefined;
      sub.lastBranchInfo = undefined;
      sub.messageBuffer = [];
    }

    this.teardownHub();
    const requestId = `sync-${Date.now()}-${++this.nextSyncRequestId}`;
    const promise = new Promise<void>((resolve, reject) => {
      const pending: PendingFullResync = { requestId, resolve, reject, signal };
      if (signal) {
        pending.abortListener = () => {
          this.rejectPendingFullResync(this.abortReason(signal));
        };
        signal.addEventListener("abort", pending.abortListener, { once: true });
      }
      this.pendingFullResync = pending;
    });

    this.hub.reconnectAttempt = 1;
    this.setHubStatus("connecting");
    this.openHubSocket();
    return promise;
  }

  syncPrWorkspaces(workspaceIds: string[]): void {
    this.prWorkspaceIds = new Set(workspaceIds);
    this.ensureHubConnected();
    this.sendSyncWorkspaces();
  }

  /** Clear cached live status for a workspace (e.g. after session deletion). */
  clearCachedData(workspaceId: string): void {
    const sub = this.subscriptions.get(workspaceId);
    if (!sub) return;
    sub.lastStatus = undefined;
    sub.lastStatusBySession.clear();
    sub.lastBranchInfo = undefined;
    sub.messageBuffer = [];
  }

  /** Unsubscribe one workspace from the hub (does not close the hub socket). */
  disconnect(workspaceId: string): void {
    this.subscribedWorkspaceIds.delete(workspaceId);
    this.sendSyncWorkspaces();
    const sub = this.subscriptions.get(workspaceId);
    if (sub) this.notifyStatusListeners(sub);
  }

  /** Disconnect all workspaces and close the hub socket. */
  disconnectAll(): void {
    this.rejectPendingFullResync(new Error("Hub disconnected during full resync"));
    this.teardownHub();
    this.subscriptions.clear();
    this.subscribedWorkspaceIds.clear();
    this.prWorkspaceIds.clear();
  }

  /**
   * Verify the hub socket is alive and reconnect if it is not. Call on window
   * focus / tab visibility / network regain — moments when a zombie socket
   * (frozen OPEN after sleep, never firing onclose) typically surfaces.
   *
   * A closed/closing/absent socket reconnects immediately. An OPEN socket is
   * actively probed with a `ping`; we reconnect only if no `pong` arrives within
   * FOCUS_PROBE_TIMEOUT_MS. Probing (rather than reconnecting any silent socket)
   * is what keeps healthy idle conversations from needlessly reconnecting.
   */
  probeLiveness(): void {
    if (this.subscribedWorkspaceIds.size === 0) return;
    const ws = this.hub.ws;
    if (!ws || ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
      this.forceReconnect();
      return;
    }
    if (ws.readyState === WebSocket.CONNECTING) return; // attempt already in flight
    const pongBefore = this.hub.lastPongAt;
    this.sendPing();
    setTimeout(() => {
      if (this.hub.ws !== ws) return; // socket already replaced
      if (this.hub.lastPongAt === pongBefore) this.forceReconnect();
    }, FOCUS_PROBE_TIMEOUT_MS);
  }

  /** Send a message to the backend for a specific workspace. Returns false if the hub isn't open. */
  send(workspaceId: string, msg: WsIncoming): boolean {
    if (!this.hub.ws || this.hub.ws.readyState !== WebSocket.OPEN) return false;
    this.hub.ws.send(JSON.stringify({ workspaceId, event: msg }));
    return true;
  }

  /**
   * Register a handler for incoming messages.
   * Replays cached live status and any buffered messages immediately.
   * Returns `{ unsubscribe, hadBufferedMessages }`.
   */
  onMessage(workspaceId: string, handler: MessageHandler): { unsubscribe: () => void; hadBufferedMessages: boolean } {
    const sub = this.getOrCreateSubscription(workspaceId);
    sub.messageHandlers.add(handler);

    if (sub.lastStatusBySession.size > 0) {
      for (const statusMsg of sub.lastStatusBySession.values()) {
        handler(statusMsg);
      }
    } else if (sub.lastStatus) {
      handler(sub.lastStatus);
    }
    if (sub.lastDiffStats) {
      handler(sub.lastDiffStats);
    }
    if (sub.lastBranchInfo) {
      handler(sub.lastBranchInfo);
    }

    const hadBufferedMessages = sub.messageBuffer.length > 0;
    for (const msg of sub.messageBuffer) {
      handler(msg);
    }
    sub.messageBuffer = [];

    return {
      unsubscribe: () => { sub.messageHandlers.delete(handler); },
      hadBufferedMessages,
    };
  }

  /** Register a callback invoked when the hub WS reconnects. */
  onReconnect(workspaceId: string, callback: () => void): () => void {
    const sub = this.getOrCreateSubscription(workspaceId);
    sub.reconnectListeners.add(callback);
    return () => { sub.reconnectListeners.delete(callback); };
  }

  /** useSyncExternalStore subscribe contract (per workspace). */
  subscribe = (workspaceId: string, listener: StatusListener): (() => void) => {
    const sub = this.getOrCreateSubscription(workspaceId);
    sub.statusListeners.add(listener);
    return () => {
      sub.statusListeners.delete(listener);
    };
  };

  /** Register a listener for ALL incoming workspace messages (used by toast notifications). */
  onGlobalMessage(handler: GlobalMessageHandler): () => void {
    this.globalListeners.add(handler);
    return () => { this.globalListeners.delete(handler); };
  }

  /** useSyncExternalStore getSnapshot contract (per workspace). */
  getStatus = (workspaceId: string): ConnectionStatus => {
    const sub = this.subscriptions.get(workspaceId);
    if (!sub) return "disconnected";
    return this.hub.status;
  };

  // ── Internal: subscription management ─────────────────────────────

  private getOrCreateSubscription(workspaceId: string): WorkspaceSubscription {
    const existing = this.subscriptions.get(workspaceId);
    if (existing) return existing;

    const created: WorkspaceSubscription = {
      messageHandlers: new Set<MessageHandler>(),
      reconnectListeners: new Set<() => void>(),
      statusListeners: new Set<StatusListener>(),
      lastStatusBySession: new Map(),
      messageBuffer: [],
    };
    this.subscriptions.set(workspaceId, created);
    return created;
  }

  private notifyStatusListeners(sub: WorkspaceSubscription): void {
    for (const listener of sub.statusListeners) listener();
  }

  // ── Internal: hub socket lifecycle ────────────────────────────────

  private setHubStatus(status: ConnectionStatus): void {
    if (this.hub.status === status) return;
    this.hub.status = status;
    for (const sub of this.subscriptions.values()) {
      this.notifyStatusListeners(sub);
    }
  }

  private ensureHubConnected(): void {
    if (
      this.hub.ws?.readyState === WebSocket.OPEN ||
      this.hub.ws?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }
    this.hub.reconnectAttempt = 0;
    this.setHubStatus("connecting");
    this.openHubSocket();
  }

  private openHubSocket(): void {
    const serverUrl = getServerUrl();
    let wsHost: string;
    if (serverUrl) {
      wsHost = serverUrl.replace(/^http/, "ws");
    } else {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      wsHost = import.meta.env.VITE_WS_URL || `${protocol}//${window.location.host}`;
    }
    const authToken = getAuthToken();
    const query = authToken ? `?token=${encodeURIComponent(authToken)}` : "";
    const ws = new WebSocket(`${wsHost}/ws/hub${query}`);
    this.hub.ws = ws;

    ws.onopen = () => {
      if (this.hub.ws !== ws) return;
      const isReconnect = this.hub.reconnectAttempt > 0;
      this.hub.reconnectAttempt = 0;
      this.hub.lastPongAt = Date.now();
      this.startHeartbeat();
      // Clear per-session status caches on reconnect (will be repopulated by bootstrap)
      for (const sub of this.subscriptions.values()) {
        sub.lastStatusBySession.clear();
      }
      // On reconnect, notify all listeners to clear stale streaming state before
      // the bootstrap replays full snapshots. Without this, the snapshot events
      // would be appended to pre-disconnect accumulated data, causing duplicates.
      if (isReconnect) {
        for (const sub of this.subscriptions.values()) {
          for (const listener of sub.reconnectListeners) listener();
        }
      }
      this.setHubStatus("connected");
      const pending = this.pendingFullResync;
      this.sendSyncWorkspaces(pending
        ? { forceBootstrap: true, requestId: pending.requestId }
        : undefined);
    };

    ws.onmessage = (event) => {
      if (this.hub.ws !== ws) return;
      try {
        const envelope = JSON.parse(event.data as string) as HubOutgoing;
        if ("type" in envelope && envelope.type === "pong") {
          this.hub.lastPongAt = Date.now();
          return;
        }
        if ("type" in envelope && envelope.type === "sync_complete") {
          if (envelope.requestId === this.pendingFullResync?.requestId) {
            this.resolvePendingFullResync();
          }
          return;
        }
        this.handleIncomingEnvelope(envelope as WorkspaceEnvelope);
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn("[ws] Failed to parse message:", err);
        }
      }
    };

    ws.onclose = () => {
      if (this.hub.ws !== ws) return;
      this.stopHeartbeat();
      this.hub.ws = null;
      this.setHubStatus("disconnected");
      if (this.subscribedWorkspaceIds.size > 0 || this.pendingFullResync) {
        this.scheduleHubReconnect();
      }
    };

    ws.onerror = () => {
      // onclose will fire after this, triggering reconnect
    };
  }

  private handleIncomingEnvelope(envelope: WorkspaceEnvelope): void {
    const { workspaceId, event: msg } = envelope;

    // Notify global listeners (toast notifications, etc.) regardless of subscription state
    for (const listener of this.globalListeners) listener(workspaceId, msg);

    const sub = this.subscriptions.get(workspaceId);
    if (!sub) return;

    // Update per-workspace live caches (history is owned by React Query / REST).
    if (msg.type === "status") {
      sub.lastStatus = msg;
      if (msg.sessionId) {
        sub.lastStatusBySession.set(msg.sessionId, msg);
      } else if (msg.status === "idle") {
        sub.lastStatusBySession.clear();
      }
    } else if (msg.type === "diff_stats") {
      sub.lastDiffStats = msg;
    } else if (msg.type === "branch_info") {
      sub.lastBranchInfo = msg;
    }

    // Clear stale per-session status cache on done/cancelled to prevent
    // replay of streaming: true after re-subscribe.
    if ((msg.type === "done" || msg.type === "cancelled") && msg.sessionId) {
      sub.lastStatusBySession.delete(msg.sessionId);
    }

    // Dispatch to handlers or buffer
    if (sub.messageHandlers.size > 0) {
      for (const handler of sub.messageHandlers) handler(msg);
    } else {
      sub.messageBuffer.push(msg);
    }
  }

  private sendSyncWorkspaces(
    options?: { forceBootstrap: true; requestId: string },
  ): void {
    if (!this.hub.ws || this.hub.ws.readyState !== WebSocket.OPEN) return;
    const message: HubIncoming = {
      type: "sync_workspaces",
      workspaceIds: [...this.subscribedWorkspaceIds],
      prWorkspaces: [...this.prWorkspaceIds],
      ...options,
    };
    this.hub.ws.send(JSON.stringify(message));
  }

  private abortReason(signal: AbortSignal): Error {
    return signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Full resync cancelled", "AbortError");
  }

  private resolvePendingFullResync(): void {
    const pending = this.pendingFullResync;
    if (!pending) return;
    this.pendingFullResync = null;
    if (pending.signal && pending.abortListener) {
      pending.signal.removeEventListener("abort", pending.abortListener);
    }
    pending.resolve();
  }

  private rejectPendingFullResync(reason: Error): void {
    const pending = this.pendingFullResync;
    if (!pending) return;
    this.pendingFullResync = null;
    if (pending.signal && pending.abortListener) {
      pending.signal.removeEventListener("abort", pending.abortListener);
    }
    pending.reject(reason);
  }

  private sendPing(): void {
    if (this.hub.ws?.readyState === WebSocket.OPEN) {
      this.hub.ws.send(JSON.stringify({ type: "ping" }));
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.hub.heartbeatTimer = setInterval(() => {
      if (!this.hub.ws || this.hub.ws.readyState !== WebSocket.OPEN) return;
      // No pong since the previous ping window → the socket is a zombie.
      if (Date.now() - this.hub.lastPongAt > HEARTBEAT_INTERVAL_MS + PONG_TIMEOUT_MS) {
        this.forceReconnect();
        return;
      }
      this.sendPing();
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.hub.heartbeatTimer) {
      clearInterval(this.hub.heartbeatTimer);
      this.hub.heartbeatTimer = null;
    }
  }

  /**
   * Tear down a (possibly zombie) socket and open a fresh one, marking it as a
   * reconnect so onReconnect listeners fire. The conversation reducer reconciles
   * non-destructively from the bootstrap (snapshot replace + REST history cache),
   * so this does not blank the visible stream.
   */
  private forceReconnect(): void {
    if (this.subscribedWorkspaceIds.size === 0 && !this.pendingFullResync) return;
    this.teardownHub();
    this.hub.reconnectAttempt = 1;
    this.setHubStatus("connecting");
    this.openHubSocket();
  }

  private scheduleHubReconnect(): void {
    if (this.hub.reconnectTimer) return;
    const delay = Math.min(
      BASE_RECONNECT_DELAY * 2 ** this.hub.reconnectAttempt,
      MAX_RECONNECT_DELAY,
    );
    this.hub.reconnectAttempt++;
    this.hub.reconnectTimer = setTimeout(() => {
      this.hub.reconnectTimer = null;
      if (this.subscribedWorkspaceIds.size === 0 && !this.pendingFullResync) return;
      this.setHubStatus("connecting");
      this.openHubSocket();
    }, delay);
  }

  private teardownHub(): void {
    this.stopHeartbeat();
    if (this.hub.reconnectTimer) {
      clearTimeout(this.hub.reconnectTimer);
      this.hub.reconnectTimer = null;
    }
    if (this.hub.ws) {
      const ws = this.hub.ws;
      this.hub.ws = null;
      ws.close();
    }
    this.hub.status = "disconnected";
  }
}

export const wsTransport = new WsTransport();
