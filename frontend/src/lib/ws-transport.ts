import type { WsIncoming, WsOutgoing } from "@/types";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

type MessageHandler = (msg: WsOutgoing) => void;
type StatusListener = () => void;
type StatusMessage = Extract<WsOutgoing, { type: "status" }>;

const MAX_RECONNECT_DELAY = 30_000;
const BASE_RECONNECT_DELAY = 1_000;
const MAX_REPLAY_MESSAGES = 1_000;

interface WorkspaceConnection {
  ws: WebSocket | null;
  status: ConnectionStatus;
  active: boolean;
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  messageHandlers: Set<MessageHandler>;
  statusListeners: Set<StatusListener>;
  lastStatus?: StatusMessage;
  replayBuffer: WsOutgoing[];
}

class WsTransport {
  private connections = new Map<string, WorkspaceConnection>();

  /** Connect to a workspace's WebSocket endpoint. */
  connect(workspaceId: string): void {
    const connection = this.getOrCreateConnection(workspaceId);
    connection.active = true;

    if (
      connection.ws?.readyState === WebSocket.OPEN ||
      connection.ws?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    connection.reconnectAttempt = 0;
    this.setStatus(connection, "connecting");
    this.openSocket(workspaceId, connection);
  }

  /** Ensure exactly this set of workspace sockets stay connected. */
  syncWorkspaces(workspaceIds: string[]): void {
    const wanted = new Set(workspaceIds);
    for (const workspaceId of wanted) {
      this.connect(workspaceId);
    }
    for (const workspaceId of Array.from(this.connections.keys())) {
      if (!wanted.has(workspaceId)) {
        this.removeConnection(workspaceId);
      }
    }
  }

  /** Disconnect one workspace and stop reconnecting. */
  disconnect(workspaceId: string): void {
    const connection = this.connections.get(workspaceId);
    if (!connection) return;
    connection.active = false;
    this.teardown(connection);
    this.setStatus(connection, "disconnected");
  }

  /** Disconnect all workspaces and clear listeners/replay state. */
  disconnectAll(): void {
    for (const workspaceId of Array.from(this.connections.keys())) {
      this.removeConnection(workspaceId);
    }
  }

  /** Send a message to the backend. Returns false if the socket isn't open. */
  send(workspaceId: string, msg: WsIncoming): boolean {
    const connection = this.connections.get(workspaceId);
    if (!connection?.ws || connection.ws.readyState !== WebSocket.OPEN) return false;
    connection.ws.send(JSON.stringify(msg));
    return true;
  }

  /** Register a handler for incoming messages. Returns an unsubscribe function. */
  onMessage(workspaceId: string, handler: MessageHandler): () => void {
    const connection = this.getOrCreateConnection(workspaceId);
    connection.messageHandlers.add(handler);

    if (connection.lastStatus) {
      handler(connection.lastStatus);
    }
    for (const buffered of connection.replayBuffer) {
      handler(buffered);
    }

    return () => {
      connection.messageHandlers.delete(handler);
    };
  }

  /** useSyncExternalStore subscribe contract (per workspace). */
  subscribe = (workspaceId: string, listener: StatusListener): (() => void) => {
    const connection = this.getOrCreateConnection(workspaceId);
    connection.statusListeners.add(listener);
    return () => {
      connection.statusListeners.delete(listener);
    };
  };

  /** useSyncExternalStore getSnapshot contract (per workspace). */
  getStatus = (workspaceId: string): ConnectionStatus =>
    this.connections.get(workspaceId)?.status ?? "disconnected";

  private getOrCreateConnection(workspaceId: string): WorkspaceConnection {
    const existing = this.connections.get(workspaceId);
    if (existing) return existing;

    const created: WorkspaceConnection = {
      ws: null,
      status: "disconnected",
      active: false,
      reconnectAttempt: 0,
      reconnectTimer: null,
      messageHandlers: new Set<MessageHandler>(),
      statusListeners: new Set<StatusListener>(),
      replayBuffer: [],
    };
    this.connections.set(workspaceId, created);
    return created;
  }

  private setStatus(connection: WorkspaceConnection, status: ConnectionStatus): void {
    if (connection.status === status) return;
    connection.status = status;
    for (const listener of connection.statusListeners) listener();
  }

  private teardown(connection: WorkspaceConnection): void {
    if (connection.reconnectTimer) {
      clearTimeout(connection.reconnectTimer);
      connection.reconnectTimer = null;
    }
    if (connection.ws) {
      const ws = connection.ws;
      connection.ws = null;
      ws.close();
    }
  }

  private removeConnection(workspaceId: string): void {
    const connection = this.connections.get(workspaceId);
    if (!connection) return;
    connection.active = false;
    this.teardown(connection);
    connection.messageHandlers.clear();
    connection.statusListeners.clear();
    connection.replayBuffer = [];
    connection.lastStatus = undefined;
    this.connections.delete(workspaceId);
  }

  private openSocket(workspaceId: string, connection: WorkspaceConnection): void {
    if (!connection.active) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsHost =
      import.meta.env.VITE_WS_URL || `${protocol}//${window.location.host}`;
    const authToken = import.meta.env.VITE_HIVE_AUTH_TOKEN?.trim();
    const query = authToken ? `?token=${encodeURIComponent(authToken)}` : "";
    const ws = new WebSocket(`${wsHost}/ws/session/${workspaceId}${query}`);
    connection.ws = ws;

    ws.onopen = () => {
      if (connection.ws !== ws) return;
      connection.reconnectAttempt = 0;
      this.setStatus(connection, "connected");
    };

    ws.onmessage = (event) => {
      if (connection.ws !== ws) return;
      try {
        const msg = JSON.parse(event.data as string) as WsOutgoing;
        if (msg.type === "status") {
          connection.lastStatus = msg;
        } else if (msg.type === "history") {
          connection.replayBuffer = [msg];
        } else {
          connection.replayBuffer.push(msg);
          if (connection.replayBuffer.length > MAX_REPLAY_MESSAGES) {
            connection.replayBuffer.shift();
          }
        }

        for (const handler of connection.messageHandlers) handler(msg);
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (connection.ws !== ws) return;
      connection.ws = null;
      this.setStatus(connection, "disconnected");
      if (connection.active) this.scheduleReconnect(workspaceId, connection);
    };

    ws.onerror = () => {
      // onclose will fire after this, triggering reconnect
    };
  }

  private scheduleReconnect(workspaceId: string, connection: WorkspaceConnection): void {
    if (connection.reconnectTimer || !connection.active) return;
    const delay = Math.min(
      BASE_RECONNECT_DELAY * 2 ** connection.reconnectAttempt,
      MAX_RECONNECT_DELAY,
    );
    connection.reconnectAttempt++;
    connection.reconnectTimer = setTimeout(() => {
      connection.reconnectTimer = null;
      if (!connection.active) return;
      this.setStatus(connection, "connecting");
      this.openSocket(workspaceId, connection);
    }, delay);
  }
}

export const wsTransport = new WsTransport();
