import { getServerUrl } from "@/hooks/useServerUrl";
import type { WsIncoming, WsOutgoing, HubOutgoing } from "@/types";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

type MessageHandler = (msg: WsOutgoing) => void;
type GlobalMessageHandler = (workspaceId: string, msg: WsOutgoing) => void;
type StatusListener = () => void;
type StatusMessage = Extract<WsOutgoing, { type: "status" }>;
export type HistoryMessage = Extract<WsOutgoing, { type: "history" }>;
type DiffStatsMessage = Extract<WsOutgoing, { type: "diff_stats" }>;
type BranchInfoMessage = Extract<WsOutgoing, { type: "branch_info" }>;

const MAX_RECONNECT_DELAY = 30_000;
const BASE_RECONNECT_DELAY = 1_000;

// ── Hub socket state ────────────────────────────────────────────────

interface HubState {
  ws: WebSocket | null;
  status: ConnectionStatus;
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
}

// ── Per-workspace subscription data (no socket) ─────────────────────

interface WorkspaceSubscription {
  messageHandlers: Set<MessageHandler>;
  reconnectListeners: Set<() => void>;
  statusListeners: Set<StatusListener>;
  lastStatus?: StatusMessage;
  lastStatusBySession: Map<string, StatusMessage>;
  lastHistory?: HistoryMessage;
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
  };
  private subscriptions = new Map<string, WorkspaceSubscription>();
  private subscribedWorkspaceIds = new Set<string>();
  private globalListeners = new Set<GlobalMessageHandler>();

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

  /** Update the cached history so switch-back replays are fresh. */
  updateCachedHistory(workspaceId: string, historyMsg: HistoryMessage): void {
    const sub = this.subscriptions.get(workspaceId);
    if (sub) sub.lastHistory = historyMsg;
  }

  /** Check whether cached history exists for a workspace. */
  hasCachedHistory(workspaceId: string): boolean {
    return this.subscriptions.get(workspaceId)?.lastHistory !== undefined;
  }

  /** Clear cached status/history for a workspace (e.g. after session deletion). */
  clearCachedData(workspaceId: string): void {
    const sub = this.subscriptions.get(workspaceId);
    if (!sub) return;
    sub.lastStatus = undefined;
    sub.lastStatusBySession.clear();
    sub.lastHistory = undefined;
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
    this.teardownHub();
    this.subscriptions.clear();
    this.subscribedWorkspaceIds.clear();
  }

  /** Send a message to the backend for a specific workspace. Returns false if the hub isn't open. */
  send(workspaceId: string, msg: WsIncoming): boolean {
    if (!this.hub.ws || this.hub.ws.readyState !== WebSocket.OPEN) return false;
    this.hub.ws.send(JSON.stringify({ workspaceId, event: msg }));
    return true;
  }

  /**
   * Register a handler for incoming messages.
   * Replays cached status, history, and any buffered messages immediately.
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
    if (sub.lastHistory) {
      handler(sub.lastHistory);
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
    const authToken = import.meta.env.VITE_HIVE_AUTH_TOKEN?.trim();
    const query = authToken ? `?token=${encodeURIComponent(authToken)}` : "";
    const ws = new WebSocket(`${wsHost}/ws/hub${query}`);
    this.hub.ws = ws;

    ws.onopen = () => {
      if (this.hub.ws !== ws) return;
      const isReconnect = this.hub.reconnectAttempt > 0;
      this.hub.reconnectAttempt = 0;
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
      this.sendSyncWorkspaces();
    };

    ws.onmessage = (event) => {
      if (this.hub.ws !== ws) return;
      try {
        const envelope = JSON.parse(event.data as string) as HubOutgoing;
        this.handleIncomingEnvelope(envelope);
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn("[ws] Failed to parse message:", err);
        }
      }
    };

    ws.onclose = () => {
      if (this.hub.ws !== ws) return;
      this.hub.ws = null;
      this.setHubStatus("disconnected");
      if (this.subscribedWorkspaceIds.size > 0) {
        this.scheduleHubReconnect();
      }
    };

    ws.onerror = () => {
      // onclose will fire after this, triggering reconnect
    };
  }

  private handleIncomingEnvelope(envelope: HubOutgoing): void {
    const { workspaceId, event: msg } = envelope;

    // Notify global listeners (toast notifications, etc.) regardless of subscription state
    for (const listener of this.globalListeners) listener(workspaceId, msg);

    const sub = this.subscriptions.get(workspaceId);
    if (!sub) return;

    // Update per-workspace caches
    if (msg.type === "status") {
      sub.lastStatus = msg;
      if (msg.sessionId) {
        sub.lastStatusBySession.set(msg.sessionId, msg);
      } else if (msg.status === "idle") {
        sub.lastStatusBySession.clear();
      }
    } else if (msg.type === "history") {
      sub.lastHistory = msg;
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

  private sendSyncWorkspaces(): void {
    if (!this.hub.ws || this.hub.ws.readyState !== WebSocket.OPEN) return;
    this.hub.ws.send(JSON.stringify({
      type: "sync_workspaces",
      workspaceIds: [...this.subscribedWorkspaceIds],
    }));
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
      if (this.subscribedWorkspaceIds.size === 0) return;
      this.setHubStatus("connecting");
      this.openHubSocket();
    }, delay);
  }

  private teardownHub(): void {
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
