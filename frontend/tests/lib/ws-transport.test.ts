import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wsTransport } from "@/lib/ws-transport";
import type { WsOutgoing } from "@/types";

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  readonly url: string;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({} as Event);
  }

  message(data: string): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  fail(): void {
    this.onerror?.({} as Event);
  }
}

describe("wsTransport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
    MockWebSocket.instances = [];
    delete import.meta.env.VITE_HIVE_AUTH_TOKEN;
    wsTransport.disconnectAll();
  });

  afterEach(() => {
    wsTransport.disconnectAll();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("connects to workspace websocket endpoint", () => {
    wsTransport.connect("ws-1");

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]?.url).toContain("/ws/session/ws-1");
    expect(wsTransport.getStatus("ws-1")).toBe("connecting");

    MockWebSocket.instances[0]?.open();
    expect(wsTransport.getStatus("ws-1")).toBe("connected");
  });

  it("adds token query parameter when auth token is configured", () => {
    import.meta.env.VITE_HIVE_AUTH_TOKEN = "secret token";
    wsTransport.connect("ws-1");

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]?.url).toContain("token=secret%20token");
  });

  it("send returns false when socket is not open", () => {
    wsTransport.connect("ws-1");
    expect(wsTransport.send("ws-1", { type: "stop" })).toBe(false);
  });

  it("send serializes and writes messages when socket is open", () => {
    wsTransport.connect("ws-1");
    const socket = MockWebSocket.instances[0]!;
    socket.open();

    const ok = wsTransport.send("ws-1", { type: "user_message", content: "hello" });

    expect(ok).toBe(true);
    expect(socket.sent).toEqual([JSON.stringify({ type: "user_message", content: "hello" })]);
  });

  it("dispatches parsed incoming messages to handlers", () => {
    wsTransport.connect("ws-1");
    const socket = MockWebSocket.instances[0]!;
    socket.open();

    const received: WsOutgoing[] = [];
    const unsub = wsTransport.onMessage("ws-1", (msg) => {
      received.push(msg);
    });

    socket.message(JSON.stringify({ type: "status", status: "idle", streaming: false }));
    socket.message("not-json");

    expect(received).toEqual([{ type: "status", status: "idle", streaming: false }]);
    unsub();
  });

  it("routes messages to the correct workspace handlers", () => {
    wsTransport.connect("ws-1");
    wsTransport.connect("ws-2");
    const socket1 = MockWebSocket.instances[0]!;
    const socket2 = MockWebSocket.instances[1]!;
    socket1.open();
    socket2.open();

    const received1: WsOutgoing[] = [];
    const received2: WsOutgoing[] = [];
    wsTransport.onMessage("ws-1", (msg) => received1.push(msg));
    wsTransport.onMessage("ws-2", (msg) => received2.push(msg));

    socket1.message(JSON.stringify({ type: "status", status: "busy", streaming: true }));
    socket2.message(JSON.stringify({ type: "status", status: "idle", streaming: false }));

    expect(received1).toEqual([{ type: "status", status: "busy", streaming: true }]);
    expect(received2).toEqual([{ type: "status", status: "idle", streaming: false }]);
  });

  it("reconnects with backoff after unexpected close while active", () => {
    wsTransport.connect("ws-1");
    const first = MockWebSocket.instances[0]!;
    first.open();
    first.close();

    expect(wsTransport.getStatus("ws-1")).toBe("disconnected");
    expect(MockWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("disconnect stops reconnect attempts for a workspace", () => {
    wsTransport.connect("ws-1");
    const first = MockWebSocket.instances[0]!;
    first.open();

    wsTransport.disconnect("ws-1");
    vi.advanceTimersByTime(60_000);

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(wsTransport.getStatus("ws-1")).toBe("disconnected");
  });

  it("syncWorkspaces disconnects removed workspaces", () => {
    wsTransport.syncWorkspaces(["ws-1", "ws-2"]);
    expect(MockWebSocket.instances).toHaveLength(2);

    wsTransport.syncWorkspaces(["ws-2"]);
    expect(wsTransport.getStatus("ws-1")).toBe("disconnected");
    expect(wsTransport.getStatus("ws-2")).toBe("connecting");
  });

  it("keeps active workspace connection when listeners are attached", () => {
    wsTransport.connect("ws-1");
    const socket = MockWebSocket.instances[0]!;
    socket.open();

    const received: WsOutgoing[] = [];
    const unsubscribe = wsTransport.onMessage("ws-1", (msg) => {
      received.push(msg);
    });

    wsTransport.syncWorkspaces([]);
    expect(wsTransport.getStatus("ws-1")).toBe("connected");

    socket.message(JSON.stringify({ type: "status", status: "idle", streaming: false }));
    expect(received).toEqual([{ type: "status", status: "idle", streaming: false }]);

    unsubscribe();
    wsTransport.syncWorkspaces([]);
    expect(wsTransport.getStatus("ws-1")).toBe("disconnected");
  });
});
