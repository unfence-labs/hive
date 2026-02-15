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
    localStorage.removeItem("hive-server-url");
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

  it("uses configured server URL as websocket host", () => {
    localStorage.setItem("hive-server-url", "http://127.0.0.1:9000");
    wsTransport.connect("ws-1");

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]?.url).toBe("ws://127.0.0.1:9000/ws/session/ws-1");
  });

  it("maps https configured server URL to wss websocket host", () => {
    localStorage.setItem("hive-server-url", "https://api.example.com");
    wsTransport.connect("ws-1");

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]?.url).toBe("wss://api.example.com/ws/session/ws-1");
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
    const { unsubscribe } = wsTransport.onMessage("ws-1", (msg) => {
      received.push(msg);
    });

    socket.message(JSON.stringify({ type: "status", status: "idle", streaming: false }));
    socket.message("not-json");

    expect(received).toEqual([{ type: "status", status: "idle", streaming: false }]);
    unsubscribe();
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
    const { unsubscribe } = wsTransport.onMessage("ws-1", (msg) => {
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

  it("replays status, history, and buffered messages to newly attached handlers", () => {
    wsTransport.connect("ws-1");
    const socket = MockWebSocket.instances[0]!;
    socket.open();

    const firstHandler: WsOutgoing[] = [];
    const { unsubscribe } = wsTransport.onMessage("ws-1", (msg) => {
      firstHandler.push(msg);
    });

    socket.message(JSON.stringify({ type: "status", status: "busy", streaming: true }));
    socket.message(JSON.stringify({
      type: "history",
      messages: [
        {
          id: "u1",
          sessionId: "s1",
          role: "user",
          content: "hello",
          timestamp: "2026-02-12T00:00:00.000Z",
        },
      ],
    }));
    socket.message(JSON.stringify({ type: "text_delta", text: "partial" }));
    socket.message(JSON.stringify({ type: "done", sessionId: "s1" }));

    expect(firstHandler).toHaveLength(4);
    unsubscribe();

    // Messages arriving while no handler is subscribed should be buffered
    socket.message(JSON.stringify({
      type: "user_message",
      message: {
        id: "u2",
        sessionId: "s1",
        role: "user",
        content: "follow-up",
        timestamp: "2026-02-12T00:01:00.000Z",
      },
    }));
    socket.message(JSON.stringify({ type: "text_delta", text: "response" }));
    socket.message(JSON.stringify({ type: "done", sessionId: "s1" }));

    const replayed: WsOutgoing[] = [];
    const result = wsTransport.onMessage("ws-1", (msg) => {
      replayed.push(msg);
    });

    expect(result.hadBufferedMessages).toBe(true);
    expect(replayed).toEqual([
      // Cached status + history
      { type: "status", status: "busy", streaming: true },
      {
        type: "history",
        messages: [
          {
            id: "u1",
            sessionId: "s1",
            role: "user",
            content: "hello",
            timestamp: "2026-02-12T00:00:00.000Z",
          },
        ],
      },
      // Buffered messages
      {
        type: "user_message",
        message: {
          id: "u2",
          sessionId: "s1",
          role: "user",
          content: "follow-up",
          timestamp: "2026-02-12T00:01:00.000Z",
        },
      },
      { type: "text_delta", text: "response" },
      { type: "done", sessionId: "s1" },
    ]);
  });

  it("returns hadBufferedMessages false when no events were missed", () => {
    wsTransport.connect("ws-1");
    const socket = MockWebSocket.instances[0]!;
    socket.open();

    // Subscribe handler BEFORE any messages arrive
    const result = wsTransport.onMessage("ws-1", () => {});
    expect(result.hadBufferedMessages).toBe(false);
  });

  describe("branch_info caching", () => {
    it("caches the latest branch_info message", () => {
      wsTransport.connect("ws-1");
      const socket = MockWebSocket.instances[0]!;
      socket.open();

      const handler: WsOutgoing[] = [];
      const { unsubscribe } = wsTransport.onMessage("ws-1", (msg) => handler.push(msg));

      const branchInfoMsg = JSON.stringify({
        type: "branch_info",
        info: { name: "workspace/tokyo", lastSyncedAt: "2026-02-15T00:00:00.000Z" },
      });
      socket.message(branchInfoMsg);
      unsubscribe();

      // New handler should receive the cached branch_info
      const replayed: WsOutgoing[] = [];
      wsTransport.onMessage("ws-1", (msg) => replayed.push(msg));

      const branchInfoReplayed = replayed.find((m) => m.type === "branch_info");
      expect(branchInfoReplayed).toEqual({
        type: "branch_info",
        info: { name: "workspace/tokyo", lastSyncedAt: "2026-02-15T00:00:00.000Z" },
      });
    });

    it("replays branch_info together with status and history", () => {
      wsTransport.connect("ws-1");
      const socket = MockWebSocket.instances[0]!;
      socket.open();

      const first: WsOutgoing[] = [];
      const { unsubscribe } = wsTransport.onMessage("ws-1", (msg) => first.push(msg));

      socket.message(JSON.stringify({ type: "status", status: "idle", streaming: false }));
      socket.message(JSON.stringify({ type: "history", messages: [] }));
      socket.message(JSON.stringify({
        type: "diff_stats",
        stats: { committed: [], uncommitted: [] },
      }));
      socket.message(JSON.stringify({
        type: "branch_info",
        info: { name: "feat/pr-sync", lastSyncedAt: "2026-02-15T01:00:00.000Z" },
      }));
      unsubscribe();

      const replayed: WsOutgoing[] = [];
      wsTransport.onMessage("ws-1", (msg) => replayed.push(msg));

      // Should replay all 4 cached message types
      const types = replayed.map((m) => m.type);
      expect(types).toContain("status");
      expect(types).toContain("history");
      expect(types).toContain("diff_stats");
      expect(types).toContain("branch_info");
    });

    it("updates cached branch_info when a newer one arrives", () => {
      wsTransport.connect("ws-1");
      const socket = MockWebSocket.instances[0]!;
      socket.open();

      const handler: WsOutgoing[] = [];
      const { unsubscribe } = wsTransport.onMessage("ws-1", (msg) => handler.push(msg));

      socket.message(JSON.stringify({
        type: "branch_info",
        info: { name: "old-branch", lastSyncedAt: "2026-02-15T00:00:00.000Z" },
      }));
      socket.message(JSON.stringify({
        type: "branch_info",
        info: { name: "new-branch", lastSyncedAt: "2026-02-15T01:00:00.000Z" },
      }));
      unsubscribe();

      const replayed: WsOutgoing[] = [];
      wsTransport.onMessage("ws-1", (msg) => replayed.push(msg));

      const branchMsgs = replayed.filter((m) => m.type === "branch_info");
      expect(branchMsgs).toHaveLength(1);
      expect((branchMsgs[0] as Extract<WsOutgoing, { type: "branch_info" }>).info.name).toBe("new-branch");
    });
  });

  describe("clearCachedData", () => {
    it("clears cached status, history, and message buffer", () => {
      wsTransport.connect("ws-1");
      const socket = MockWebSocket.instances[0]!;
      socket.open();

      // Populate caches: send status + history, then unsubscribe so buffer fills
      const first: WsOutgoing[] = [];
      const { unsubscribe } = wsTransport.onMessage("ws-1", (msg) => first.push(msg));
      socket.message(JSON.stringify({ type: "status", status: "busy", streaming: true }));
      socket.message(JSON.stringify({ type: "history", messages: [] }));
      unsubscribe();

      // Buffer a message while no handler is attached
      socket.message(JSON.stringify({ type: "text_delta", text: "buffered" }));

      // Clear everything
      wsTransport.clearCachedData("ws-1");

      // New handler should receive nothing
      const replayed: WsOutgoing[] = [];
      const result = wsTransport.onMessage("ws-1", (msg) => replayed.push(msg));
      expect(replayed).toEqual([]);
      expect(result.hadBufferedMessages).toBe(false);
    });

    it("is a no-op for unknown workspace", () => {
      // Should not throw
      wsTransport.clearCachedData("unknown-ws");
    });

    it("does not disconnect the socket", () => {
      wsTransport.connect("ws-1");
      const socket = MockWebSocket.instances[0]!;
      socket.open();

      wsTransport.clearCachedData("ws-1");

      expect(wsTransport.getStatus("ws-1")).toBe("connected");
      expect(socket.readyState).toBe(MockWebSocket.OPEN);
    });

    it("clears cached branch_info along with other cached data", () => {
      wsTransport.connect("ws-1");
      const socket = MockWebSocket.instances[0]!;
      socket.open();

      const first: WsOutgoing[] = [];
      const { unsubscribe } = wsTransport.onMessage("ws-1", (msg) => first.push(msg));
      socket.message(JSON.stringify({
        type: "branch_info",
        info: { name: "workspace/tokyo", lastSyncedAt: "2026-02-15T00:00:00.000Z" },
      }));
      unsubscribe();

      wsTransport.clearCachedData("ws-1");

      const replayed: WsOutgoing[] = [];
      wsTransport.onMessage("ws-1", (msg) => replayed.push(msg));
      expect(replayed.find((m) => m.type === "branch_info")).toBeUndefined();
    });

    it("allows fresh data to accumulate after clearing", () => {
      wsTransport.connect("ws-1");
      const socket = MockWebSocket.instances[0]!;
      socket.open();

      // Populate and clear
      const first: WsOutgoing[] = [];
      const { unsubscribe: unsub1 } = wsTransport.onMessage("ws-1", (msg) => first.push(msg));
      socket.message(JSON.stringify({ type: "status", status: "busy", streaming: true }));
      unsub1();
      wsTransport.clearCachedData("ws-1");

      // Attach a handler, then send new status — handler receives it live
      const live: WsOutgoing[] = [];
      const { unsubscribe: unsub2 } = wsTransport.onMessage("ws-1", (msg) => live.push(msg));
      socket.message(JSON.stringify({ type: "status", status: "idle", streaming: false }));
      unsub2();

      // Re-attach: should replay the fresh cached status (not the old "busy" one)
      const replayed: WsOutgoing[] = [];
      wsTransport.onMessage("ws-1", (msg) => replayed.push(msg));
      expect(replayed).toEqual([{ type: "status", status: "idle", streaming: false }]);
    });
  });
});
