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
    wsTransport.disconnect();
  });

  afterEach(() => {
    wsTransport.disconnect();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("connects to workspace websocket endpoint", () => {
    wsTransport.connect("ws-1");

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]?.url).toContain("/ws/session/ws-1");
    expect(wsTransport.getStatus()).toBe("connecting");

    MockWebSocket.instances[0]?.open();
    expect(wsTransport.getStatus()).toBe("connected");
  });

  it("adds token query parameter when auth token is configured", () => {
    import.meta.env.VITE_HIVE_AUTH_TOKEN = "secret token";
    wsTransport.connect("ws-1");

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]?.url).toContain("token=secret%20token");
  });

  it("send returns false when socket is not open", () => {
    wsTransport.connect("ws-1");
    expect(wsTransport.send({ type: "stop" })).toBe(false);
  });

  it("send serializes and writes messages when socket is open", () => {
    wsTransport.connect("ws-1");
    const socket = MockWebSocket.instances[0]!;
    socket.open();

    const ok = wsTransport.send({ type: "user_message", content: "hello" });

    expect(ok).toBe(true);
    expect(socket.sent).toEqual([JSON.stringify({ type: "user_message", content: "hello" })]);
  });

  it("dispatches parsed incoming messages to handlers", () => {
    wsTransport.connect("ws-1");
    const socket = MockWebSocket.instances[0]!;
    socket.open();

    const received: WsOutgoing[] = [];
    const unsub = wsTransport.onMessage((msg) => {
      received.push(msg);
    });

    socket.message(JSON.stringify({ type: "status", status: "idle", streaming: false }));
    socket.message("not-json");

    expect(received).toEqual([{ type: "status", status: "idle", streaming: false }]);
    unsub();
  });

  it("reconnects with backoff after unexpected close while active", () => {
    wsTransport.connect("ws-1");
    const first = MockWebSocket.instances[0]!;
    first.open();
    first.close();

    expect(wsTransport.getStatus()).toBe("disconnected");
    expect(MockWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("disconnect stops reconnect attempts", () => {
    wsTransport.connect("ws-1");
    const first = MockWebSocket.instances[0]!;
    first.open();

    wsTransport.disconnect();
    vi.advanceTimersByTime(60_000);

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(wsTransport.getStatus()).toBe("disconnected");
  });
});
