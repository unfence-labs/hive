import type { WsIncoming, WsOutgoing } from "@/types";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

type MessageHandler = (msg: WsOutgoing) => void;

const MAX_RECONNECT_DELAY = 30_000;
const BASE_RECONNECT_DELAY = 1_000;

class WsTransport {
  private ws: WebSocket | null = null;
  private currentWorkspaceId: string | null = null;
  private _status: ConnectionStatus = "disconnected";
  private active = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private messageHandlers = new Set<MessageHandler>();
  private statusListeners = new Set<() => void>();

  /** Connect to a workspace's WebSocket endpoint. Tears down any existing connection first. */
  connect(workspaceId: string): void {
    if (
      this.currentWorkspaceId === workspaceId &&
      this.ws?.readyState === WebSocket.OPEN
    ) {
      return;
    }

    this.teardown();
    this.active = true;
    this.currentWorkspaceId = workspaceId;
    this.reconnectAttempt = 0;
    this.setStatus("connecting");
    this.openSocket();
  }

  /** Disconnect and stop reconnecting. */
  disconnect(): void {
    this.active = false;
    this.teardown();
    this.setStatus("disconnected");
  }

  /** Send a message to the backend. Returns false if the socket isn't open. */
  send(msg: WsIncoming): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /** Register a handler for incoming messages. Returns an unsubscribe function. */
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  /** useSyncExternalStore subscribe contract. */
  subscribe = (listener: () => void): (() => void) => {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  };

  /** useSyncExternalStore getSnapshot contract. */
  getStatus = (): ConnectionStatus => this._status;

  private setStatus(s: ConnectionStatus): void {
    if (this._status === s) return;
    this._status = s;
    for (const listener of this.statusListeners) listener();
  }

  private teardown(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private openSocket(): void {
    if (!this.currentWorkspaceId) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsHost =
      import.meta.env.VITE_WS_URL || `${protocol}//${window.location.host}`;
    const authToken = import.meta.env.VITE_HIVE_AUTH_TOKEN?.trim();
    const query = authToken ? `?token=${encodeURIComponent(authToken)}` : "";
    const ws = new WebSocket(
      `${wsHost}/ws/session/${this.currentWorkspaceId}${query}`,
    );
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.reconnectAttempt = 0;
      this.setStatus("connected");
    };

    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      try {
        const msg = JSON.parse(event.data as string) as WsOutgoing;
        for (const handler of this.messageHandlers) handler(msg);
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.setStatus("disconnected");
      if (this.active) this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose will fire after this, triggering reconnect
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(
      BASE_RECONNECT_DELAY * 2 ** this.reconnectAttempt,
      MAX_RECONNECT_DELAY,
    );
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.active) this.openSocket();
    }, delay);
  }
}

export const wsTransport = new WsTransport();
