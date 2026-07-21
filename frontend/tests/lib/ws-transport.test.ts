import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wsTransport } from "@/lib/ws-transport";
import type { WsOutgoing, HubOutgoing } from "@/types";

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

  /** Send a hub envelope message to the transport. */
  hubMessage(workspaceId: string, event: WsOutgoing): void {
    const envelope: HubOutgoing = { workspaceId, event };
    this.onmessage?.({ data: JSON.stringify(envelope) } as MessageEvent);
  }

  /** Send raw data (for testing malformed messages). */
  message(data: string): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  fail(): void {
    this.onerror?.({} as Event);
  }
}

/** Get the sync_workspaces messages sent by the hub socket. */
function getSyncMessages(socket: MockWebSocket): string[][] {
  return socket.sent
    .map((s) => { try { return JSON.parse(s); } catch { return null; } })
    .filter((m) => m?.type === "sync_workspaces")
    .map((m) => m.workspaceIds as string[]);
}

/** Get workspace event envelopes sent by the hub socket. */
function getEventEnvelopes(socket: MockWebSocket): Array<{ workspaceId: string; event: object }> {
  return socket.sent
    .map((s) => { try { return JSON.parse(s); } catch { return null; } })
    .filter((m) => m?.workspaceId && m?.event);
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

  it("connects to hub websocket endpoint (not per-workspace)", () => {
    wsTransport.connect("ws-1");

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]?.url).toContain("/ws/hub");
    expect(MockWebSocket.instances[0]?.url).not.toContain("/ws/session/");
    expect(wsTransport.getStatus("ws-1")).toBe("connecting");

    MockWebSocket.instances[0]?.open();
    expect(wsTransport.getStatus("ws-1")).toBe("connected");
  });

  it("sends sync_workspaces on hub connect", () => {
    wsTransport.connect("ws-1");
    const socket = MockWebSocket.instances[0]!;
    socket.open();

    const syncs = getSyncMessages(socket);
    expect(syncs).toEqual([["ws-1"]]);
  });

  it("requestBootstrap resends sync_workspaces with forceBootstrap on an open socket", () => {
    wsTransport.connect("ws-1");
    wsTransport.connect("ws-2");
    const socket = MockWebSocket.instances[0]!;
    socket.open();

    wsTransport.requestBootstrap();

    const parsed = socket.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
    const forced = parsed.filter((m) => m.type === "sync_workspaces" && m.forceBootstrap === true);
    expect(forced).toHaveLength(1);
    expect(forced[0]!.workspaceIds).toEqual(expect.arrayContaining(["ws-1", "ws-2"]));
  });

  it("requestBootstrap is a no-op while the socket is not open (connect bootstrap covers it)", () => {
    wsTransport.connect("ws-1");
    const socket = MockWebSocket.instances[0]!;

    wsTransport.requestBootstrap();
    expect(socket.sent).toHaveLength(0);

    socket.open();
    const parsed = socket.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
    expect(parsed.filter((m) => m.forceBootstrap === true)).toHaveLength(0);
  });

  it("uses a single hub socket for multiple workspaces", () => {
    wsTransport.connect("ws-1");
    wsTransport.connect("ws-2");

    // Only one WebSocket instance should be created
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("sends updated sync_workspaces when adding a workspace", () => {
    wsTransport.connect("ws-1");
    const socket = MockWebSocket.instances[0]!;
    socket.open();

    wsTransport.connect("ws-2");

    const syncs = getSyncMessages(socket);
    // First sync: ["ws-1"], then ["ws-1", "ws-2"]
    expect(syncs.length).toBe(2);
    expect(syncs[1]).toEqual(expect.arrayContaining(["ws-1", "ws-2"]));
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
    expect(MockWebSocket.instances[0]?.url).toBe("ws://127.0.0.1:9000/ws/hub");
  });

  it("maps https configured server URL to wss websocket host", () => {
    localStorage.setItem("hive-server-url", "https://api.example.com");
    wsTransport.connect("ws-1");

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]?.url).toBe("wss://api.example.com/ws/hub");
  });

  it("send returns false when socket is not open", () => {
    wsTransport.connect("ws-1");
    expect(wsTransport.send("ws-1", { type: "stop" })).toBe(false);
  });

  it("send wraps messages in hub envelope", () => {
    wsTransport.connect("ws-1");
    const socket = MockWebSocket.instances[0]!;
    socket.open();

    const ok = wsTransport.send("ws-1", { type: "user_message", content: "hello" });

    expect(ok).toBe(true);
    const envelopes = getEventEnvelopes(socket);
    expect(envelopes).toContainEqual({
      workspaceId: "ws-1",
      event: { type: "user_message", content: "hello" },
    });
  });

  it("does not cache or replay history-shaped messages (history is owned by REST now)", () => {
    wsTransport.connect("ws-1");
    const socket = MockWebSocket.instances[0]!;
    socket.open();

    // A live handler receives the history message as a plain pass-through event,
    const first: WsOutgoing[] = [];
    const { unsubscribe } = wsTransport.onMessage("ws-1", (msg) => first.push(msg));
    socket.hubMessage("ws-1", {
      type: "history",
      sessionId: "sess-1",
      messages: [
        { id: "m1", sessionId: "sess-1", role: "user", content: "live", timestamp: "2026-02-20T00:00:00.000Z" },
      ],
    } as WsOutgoing);
    expect(first).toHaveLength(1);
    unsubscribe();

    // but it is NOT cached, so a fresh handler does not get it replayed.
    const replayed: WsOutgoing[] = [];
    const result = wsTransport.onMessage("ws-1", (msg) => replayed.push(msg));
    expect(replayed.find((m) => m.type === "history")).toBeUndefined();
    expect(result.hadBufferedMessages).toBe(false);
  });

  it("dispatches parsed incoming messages to handlers (via hub envelope)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    wsTransport.connect("ws-1");
    const socket = MockWebSocket.instances[0]!;
    socket.open();

    const received: WsOutgoing[] = [];
    const { unsubscribe } = wsTransport.onMessage("ws-1", (msg) => {
      received.push(msg);
    });

    socket.hubMessage("ws-1", { type: "status", status: "idle", streaming: false });
    socket.message("not-json");

    expect(received).toEqual([{ type: "status", status: "idle", streaming: false }]);
    expect(warnSpy).toHaveBeenCalledWith(
      "[ws] Failed to parse message:",
      expect.any(SyntaxError),
    );
    unsubscribe();
  });

  it("routes messages to the correct workspace handlers via hub demux", () => {
    wsTransport.syncWorkspaces(["ws-1", "ws-2"]);
    const socket = MockWebSocket.instances[0]!;
    socket.open();

    const received1: WsOutgoing[] = [];
    const received2: WsOutgoing[] = [];
    wsTransport.onMessage("ws-1", (msg) => received1.push(msg));
    wsTransport.onMessage("ws-2", (msg) => received2.push(msg));

    socket.hubMessage("ws-1", { type: "status", status: "busy", streaming: true });
    socket.hubMessage("ws-2", { type: "status", status: "idle", streaming: false });

    expect(received1).toEqual([{ type: "status", status: "busy", streaming: true }]);
    expect(received2).toEqual([{ type: "status", status: "idle", streaming: false }]);
  });

  it("ignores messages for unsubscribed workspaces", () => {
    wsTransport.connect("ws-1");
    const socket = MockWebSocket.instances[0]!;
    socket.open();

    const received: WsOutgoing[] = [];
    wsTransport.onMessage("ws-1", (msg) => received.push(msg));

    // Send message for an unsubscribed workspace
    socket.hubMessage("ws-unknown", { type: "status", status: "idle", streaming: false });

    expect(received).toEqual([]);
  });

  it("notifies global listeners for messages from any workspace id", () => {
    wsTransport.connect("ws-1");
    const socket = MockWebSocket.instances[0]!;
    socket.open();

    const global = vi.fn();
    wsTransport.onGlobalMessage(global);

    socket.hubMessage("ws-1", { type: "status", status: "idle", streaming: false });
    socket.hubMessage("ws-unsubscribed", { type: "error", message: "boom" });

    expect(global).toHaveBeenCalledTimes(2);
    expect(global).toHaveBeenNthCalledWith(1, "ws-1", { type: "status", status: "idle", streaming: false });
    expect(global).toHaveBeenNthCalledWith(2, "ws-unsubscribed", { type: "error", message: "boom" });
  });

  it("stops notifying a global listener after unsubscribe", () => {
    wsTransport.connect("ws-1");
    const socket = MockWebSocket.instances[0]!;
    socket.open();

    const global = vi.fn();
    const unsubscribe = wsTransport.onGlobalMessage(global);

    socket.hubMessage("ws-1", { type: "status", status: "busy", streaming: true });
    unsubscribe();
    socket.hubMessage("ws-1", { type: "status", status: "idle", streaming: false });

    expect(global).toHaveBeenCalledTimes(1);
    expect(global).toHaveBeenLastCalledWith("ws-1", { type: "status", status: "busy", streaming: true });
  });

  it("notifies all registered global listeners", () => {
    wsTransport.connect("ws-1");
    const socket = MockWebSocket.instances[0]!;
    socket.open();

    const listenerA = vi.fn();
    const listenerB = vi.fn();
    wsTransport.onGlobalMessage(listenerA);
    wsTransport.onGlobalMessage(listenerB);

    socket.hubMessage("ws-1", { type: "done", sessionId: "sess-1" });

    expect(listenerA).toHaveBeenCalledWith("ws-1", { type: "done", sessionId: "sess-1" });
    expect(listenerB).toHaveBeenCalledWith("ws-1", { type: "done", sessionId: "sess-1" });
  });

  it("reconnects with backoff after unexpected close while subscribed", () => {
    wsTransport.connect("ws-1");
    const first = MockWebSocket.instances[0]!;
    first.open();
    first.close();

    expect(wsTransport.getStatus("ws-1")).toBe("disconnected");
    expect(MockWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("re-sends sync_workspaces on reconnect", () => {
    wsTransport.syncWorkspaces(["ws-1", "ws-2"]);
    const first = MockWebSocket.instances[0]!;
    first.open();
    first.close();

    vi.advanceTimersByTime(1000);
    const second = MockWebSocket.instances[1]!;
    second.open();

    const syncs = getSyncMessages(second);
    expect(syncs.length).toBe(1);
    expect(syncs[0]).toEqual(expect.arrayContaining(["ws-1", "ws-2"]));
  });

  it("disconnect removes workspace from sync but keeps hub socket open", () => {
    wsTransport.syncWorkspaces(["ws-1", "ws-2"]);
    const socket = MockWebSocket.instances[0]!;
    socket.open();

    wsTransport.disconnect("ws-1");

    // Hub socket should still be open
    expect(socket.readyState).toBe(MockWebSocket.OPEN);

    // Should have sent updated sync_workspaces without ws-1
    const syncs = getSyncMessages(socket);
    const lastSync = syncs[syncs.length - 1];
    expect(lastSync).toEqual(["ws-2"]);
  });

  it("disconnectAll stops reconnect attempts", () => {
    wsTransport.connect("ws-1");
    const first = MockWebSocket.instances[0]!;
    first.open();

    wsTransport.disconnectAll();
    vi.advanceTimersByTime(60_000);

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(wsTransport.getStatus("ws-1")).toBe("disconnected");
  });

  it("syncWorkspaces removes unsubscribed workspaces without listeners", () => {
    wsTransport.syncWorkspaces(["ws-1", "ws-2"]);
    expect(MockWebSocket.instances).toHaveLength(1);

    wsTransport.syncWorkspaces(["ws-2"]);
    // ws-1 should report disconnected since it has no subscription data
    expect(wsTransport.getStatus("ws-1")).toBe("disconnected");
    expect(wsTransport.getStatus("ws-2")).toBe("connecting");
  });

  it("keeps workspace subscription when listeners are attached even if not in sync set", () => {
    wsTransport.connect("ws-1");
    const socket = MockWebSocket.instances[0]!;
    socket.open();

    const received: WsOutgoing[] = [];
    const { unsubscribe } = wsTransport.onMessage("ws-1", (msg) => {
      received.push(msg);
    });

    wsTransport.syncWorkspaces([]);
    // Subscription data survives because handler is attached
    expect(wsTransport.getStatus("ws-1")).toBe("connected");

    socket.hubMessage("ws-1", { type: "status", status: "idle", streaming: false });
    expect(received).toEqual([{ type: "status", status: "idle", streaming: false }]);

    unsubscribe();
    wsTransport.syncWorkspaces([]);
    expect(wsTransport.getStatus("ws-1")).toBe("disconnected");
  });

  it("keeps workspace subscription when only status listeners are attached", () => {
    wsTransport.connect("ws-1");
    const socket = MockWebSocket.instances[0]!;
    socket.open();

    const unsubscribeStatus = wsTransport.subscribe("ws-1", vi.fn());

    wsTransport.syncWorkspaces([]);
    expect(wsTransport.getStatus("ws-1")).toBe("connected");

    unsubscribeStatus();
    wsTransport.syncWorkspaces([]);
    expect(wsTransport.getStatus("ws-1")).toBe("disconnected");
  });

  it("replays cached status and buffered messages to newly attached handlers", () => {
    wsTransport.connect("ws-1");
    const socket = MockWebSocket.instances[0]!;
    socket.open();

    const firstHandler: WsOutgoing[] = [];
    const { unsubscribe } = wsTransport.onMessage("ws-1", (msg) => {
      firstHandler.push(msg);
    });

    socket.hubMessage("ws-1", { type: "status", status: "busy", streaming: true });
    socket.hubMessage("ws-1", { type: "text_delta", sessionId: "s1", text: "partial" });
    socket.hubMessage("ws-1", { type: "done", sessionId: "s1" });

    expect(firstHandler).toHaveLength(3);
    unsubscribe();

    // Messages arriving while no handler is subscribed should be buffered
    socket.hubMessage("ws-1", {
      type: "user_message",
      message: {
        id: "u2",
        sessionId: "s1",
        role: "user",
        content: "follow-up",
        timestamp: "2026-02-12T00:01:00.000Z",
      },
    } as WsOutgoing);
    socket.hubMessage("ws-1", { type: "text_delta", sessionId: "s1", text: "response" });
    socket.hubMessage("ws-1", { type: "done", sessionId: "s1" });

    const replayed: WsOutgoing[] = [];
    const result = wsTransport.onMessage("ws-1", (msg) => {
      replayed.push(msg);
    });

    expect(result.hadBufferedMessages).toBe(true);
    expect(replayed).toEqual([
      // Cached status (history is no longer cached/replayed — it comes from REST)
      { type: "status", status: "busy", streaming: true },
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
      { type: "text_delta", sessionId: "s1", text: "response" },
      { type: "done", sessionId: "s1" },
    ]);
  });

  it("replays all buffered events from any session", () => {
    wsTransport.connect("ws-1");
    const socket = MockWebSocket.instances[0]!;
    socket.open();

    const firstHandler: WsOutgoing[] = [];
    const { unsubscribe } = wsTransport.onMessage("ws-1", (msg) => {
      firstHandler.push(msg);
    });

    socket.hubMessage("ws-1", {
      type: "status",
      status: "busy",
      streaming: true,
      sessionId: "s-new",
    });
    unsubscribe();

    // Buffer events from multiple sessions while no message handlers are attached.
    socket.hubMessage("ws-1", { type: "text_delta", sessionId: "s-old", text: "stale" });
    socket.hubMessage("ws-1", { type: "done", sessionId: "s-old" });
    socket.hubMessage("ws-1", { type: "text_delta", sessionId: "s-new", text: "fresh" });
    socket.hubMessage("ws-1", { type: "done", sessionId: "s-new" });

    const replayed: WsOutgoing[] = [];
    const result = wsTransport.onMessage("ws-1", (msg) => replayed.push(msg));

    expect(result.hadBufferedMessages).toBe(true);
    expect(replayed).toEqual([
      { type: "status", status: "busy", streaming: true, sessionId: "s-new" },
      { type: "text_delta", sessionId: "s-old", text: "stale" },
      { type: "done", sessionId: "s-old" },
      { type: "text_delta", sessionId: "s-new", text: "fresh" },
      { type: "done", sessionId: "s-new" },
    ]);
  });

  it("replays latest status per session and resets to global idle status", () => {
    wsTransport.connect("ws-1");
    const socket = MockWebSocket.instances[0]!;
    socket.open();

    const first = wsTransport.onMessage("ws-1", () => {});

    socket.hubMessage("ws-1", {
      type: "status",
      status: "busy",
      streaming: true,
      sessionId: "sess-1",
    });
    socket.hubMessage("ws-1", {
      type: "status",
      status: "busy",
      streaming: true,
      sessionId: "sess-2",
    });
    first.unsubscribe();

    const replayedPerSession: WsOutgoing[] = [];
    const second = wsTransport.onMessage("ws-1", (msg) => {
      replayedPerSession.push(msg);
    });
    const statuses = replayedPerSession.filter((m) => m.type === "status");
    expect(statuses).toHaveLength(2);
    expect(statuses).toEqual(expect.arrayContaining([
      { type: "status", status: "busy", streaming: true, sessionId: "sess-1" },
      { type: "status", status: "busy", streaming: true, sessionId: "sess-2" },
    ]));

    socket.hubMessage("ws-1", { type: "status", status: "idle", streaming: false });
    second.unsubscribe();

    const replayedAfterIdle: WsOutgoing[] = [];
    wsTransport.onMessage("ws-1", (msg) => {
      replayedAfterIdle.push(msg);
    });
    expect(replayedAfterIdle).toEqual([{ type: "status", status: "idle", streaming: false }]);
  });

  it("returns hadBufferedMessages false when no events were missed", () => {
    wsTransport.connect("ws-1");
    const socket = MockWebSocket.instances[0]!;
    socket.open();

    const result = wsTransport.onMessage("ws-1", () => {});
    expect(result.hadBufferedMessages).toBe(false);
  });

  it("hub status is reflected in all workspace getStatus() calls", () => {
    wsTransport.syncWorkspaces(["ws-1", "ws-2"]);
    const socket = MockWebSocket.instances[0]!;

    expect(wsTransport.getStatus("ws-1")).toBe("connecting");
    expect(wsTransport.getStatus("ws-2")).toBe("connecting");

    socket.open();
    expect(wsTransport.getStatus("ws-1")).toBe("connected");
    expect(wsTransport.getStatus("ws-2")).toBe("connected");

    socket.close();
    expect(wsTransport.getStatus("ws-1")).toBe("disconnected");
    expect(wsTransport.getStatus("ws-2")).toBe("disconnected");
  });

  describe("branch_info caching", () => {
    it("caches the latest branch_info message", () => {
      wsTransport.connect("ws-1");
      const socket = MockWebSocket.instances[0]!;
      socket.open();

      const handler: WsOutgoing[] = [];
      const { unsubscribe } = wsTransport.onMessage("ws-1", (msg) => handler.push(msg));

      socket.hubMessage("ws-1", {
        type: "branch_info",
        info: { name: "workspace/tokyo", lastSyncedAt: "2026-02-15T00:00:00.000Z" },
      });
      unsubscribe();

      const replayed: WsOutgoing[] = [];
      wsTransport.onMessage("ws-1", (msg) => replayed.push(msg));

      const branchInfoReplayed = replayed.find((m) => m.type === "branch_info");
      expect(branchInfoReplayed).toEqual({
        type: "branch_info",
        info: { name: "workspace/tokyo", lastSyncedAt: "2026-02-15T00:00:00.000Z" },
      });
    });

    it("replays branch_info together with status and diff_stats", () => {
      wsTransport.connect("ws-1");
      const socket = MockWebSocket.instances[0]!;
      socket.open();

      const first: WsOutgoing[] = [];
      const { unsubscribe } = wsTransport.onMessage("ws-1", (msg) => first.push(msg));

      socket.hubMessage("ws-1", { type: "status", status: "idle", streaming: false });
      socket.hubMessage("ws-1", {
        type: "diff_stats",
        stats: { committed: [], uncommitted: [] },
      } as WsOutgoing);
      socket.hubMessage("ws-1", {
        type: "branch_info",
        info: { name: "feat/pr-sync", lastSyncedAt: "2026-02-15T01:00:00.000Z" },
      });
      unsubscribe();

      const replayed: WsOutgoing[] = [];
      wsTransport.onMessage("ws-1", (msg) => replayed.push(msg));

      const types = replayed.map((m) => m.type);
      expect(types).toContain("status");
      expect(types).toContain("diff_stats");
      expect(types).toContain("branch_info");
      // History is no longer cached/replayed (owned by REST).
      expect(types).not.toContain("history");
    });

    it("updates cached branch_info when a newer one arrives", () => {
      wsTransport.connect("ws-1");
      const socket = MockWebSocket.instances[0]!;
      socket.open();

      const handler: WsOutgoing[] = [];
      const { unsubscribe } = wsTransport.onMessage("ws-1", (msg) => handler.push(msg));

      socket.hubMessage("ws-1", {
        type: "branch_info",
        info: { name: "old-branch", lastSyncedAt: "2026-02-15T00:00:00.000Z" },
      });
      socket.hubMessage("ws-1", {
        type: "branch_info",
        info: { name: "new-branch", lastSyncedAt: "2026-02-15T01:00:00.000Z" },
      });
      unsubscribe();

      const replayed: WsOutgoing[] = [];
      wsTransport.onMessage("ws-1", (msg) => replayed.push(msg));

      const branchMsgs = replayed.filter((m) => m.type === "branch_info");
      expect(branchMsgs).toHaveLength(1);
      expect((branchMsgs[0] as Extract<WsOutgoing, { type: "branch_info" }>).info.name).toBe("new-branch");
    });
  });

  describe("clearCachedData", () => {
    it("clears cached status and message buffer", () => {
      wsTransport.connect("ws-1");
      const socket = MockWebSocket.instances[0]!;
      socket.open();

      const first: WsOutgoing[] = [];
      const { unsubscribe } = wsTransport.onMessage("ws-1", (msg) => first.push(msg));
      socket.hubMessage("ws-1", { type: "status", status: "busy", streaming: true });
      unsubscribe();

      socket.hubMessage("ws-1", { type: "text_delta", sessionId: "s1", text: "buffered" });

      wsTransport.clearCachedData("ws-1");

      const replayed: WsOutgoing[] = [];
      const result = wsTransport.onMessage("ws-1", (msg) => replayed.push(msg));
      expect(replayed).toEqual([]);
      expect(result.hadBufferedMessages).toBe(false);
    });

    it("is a no-op for unknown workspace", () => {
      wsTransport.clearCachedData("unknown-ws");
    });

    it("does not close the hub socket", () => {
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
      socket.hubMessage("ws-1", {
        type: "branch_info",
        info: { name: "workspace/tokyo", lastSyncedAt: "2026-02-15T00:00:00.000Z" },
      });
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

      const first: WsOutgoing[] = [];
      const { unsubscribe: unsub1 } = wsTransport.onMessage("ws-1", (msg) => first.push(msg));
      socket.hubMessage("ws-1", { type: "status", status: "busy", streaming: true });
      unsub1();
      wsTransport.clearCachedData("ws-1");

      const live: WsOutgoing[] = [];
      const { unsubscribe: unsub2 } = wsTransport.onMessage("ws-1", (msg) => live.push(msg));
      socket.hubMessage("ws-1", { type: "status", status: "idle", streaming: false });
      unsub2();

      const replayed: WsOutgoing[] = [];
      wsTransport.onMessage("ws-1", (msg) => replayed.push(msg));
      expect(replayed).toEqual([{ type: "status", status: "idle", streaming: false }]);
    });
  });

  describe("heartbeat + liveness", () => {
    const getPings = (socket: MockWebSocket): unknown[] =>
      socket.sent
        .map((s) => { try { return JSON.parse(s); } catch { return null; } })
        .filter((m) => m?.type === "ping");
    const sendPong = (socket: MockWebSocket): void =>
      socket.message(JSON.stringify({ type: "pong" }));

    it("sends an app-level ping on the heartbeat interval", () => {
      wsTransport.connect("ws-1");
      const socket = MockWebSocket.instances[0]!;
      socket.open();

      expect(getPings(socket)).toHaveLength(0);
      vi.advanceTimersByTime(25_000);
      expect(getPings(socket).length).toBeGreaterThanOrEqual(1);
    });

    it("keeps a socket that answers pongs (no reconnect)", () => {
      wsTransport.connect("ws-1");
      const socket = MockWebSocket.instances[0]!;
      socket.open();

      for (let i = 0; i < 4; i++) {
        vi.advanceTimersByTime(25_000);
        sendPong(socket);
      }

      expect(MockWebSocket.instances).toHaveLength(1);
      expect(socket.readyState).toBe(MockWebSocket.OPEN);
    });

    it("reconnects a zombie socket that never answers pongs", () => {
      wsTransport.connect("ws-1");
      const socket = MockWebSocket.instances[0]!;
      socket.open();

      // Silent past HEARTBEAT_INTERVAL_MS + PONG_TIMEOUT_MS (25s + 10s).
      vi.advanceTimersByTime(60_000);

      expect(MockWebSocket.instances).toHaveLength(2);
    });

    it("ignores pong frames (does not forward them as workspace events)", () => {
      const received: WsOutgoing[] = [];
      wsTransport.connect("ws-1");
      const socket = MockWebSocket.instances[0]!;
      socket.open();
      wsTransport.onMessage("ws-1", (msg) => received.push(msg));

      sendPong(socket);

      expect(received).toHaveLength(0);
    });
  });

  describe("probeLiveness", () => {
    const sendPong = (socket: MockWebSocket): void =>
      socket.message(JSON.stringify({ type: "pong" }));

    it("is a no-op when nothing is subscribed", () => {
      wsTransport.probeLiveness();
      expect(MockWebSocket.instances).toHaveLength(0);
    });

    it("does not reconnect a healthy OPEN socket that answers the probe", () => {
      wsTransport.connect("ws-1");
      const socket = MockWebSocket.instances[0]!;
      socket.open();

      wsTransport.probeLiveness();
      vi.advanceTimersByTime(100); // pong round-trips before the probe deadline
      sendPong(socket);
      vi.advanceTimersByTime(3_000);

      expect(MockWebSocket.instances).toHaveLength(1);
      expect(socket.readyState).toBe(MockWebSocket.OPEN);
    });

    it("reconnects an OPEN-but-frozen socket that ignores the probe", () => {
      wsTransport.connect("ws-1");
      const socket = MockWebSocket.instances[0]!;
      socket.open();

      wsTransport.probeLiveness();
      vi.advanceTimersByTime(3_000); // no pong arrives within the probe window

      expect(MockWebSocket.instances).toHaveLength(2);
    });

    it("reconnects immediately when the socket is closed", () => {
      wsTransport.connect("ws-1");
      const socket = MockWebSocket.instances[0]!;
      socket.open();
      socket.readyState = MockWebSocket.CLOSED;

      wsTransport.probeLiveness();

      expect(MockWebSocket.instances).toHaveLength(2);
    });

    it("is a no-op while a connection attempt is already in flight", () => {
      wsTransport.connect("ws-1");
      expect(MockWebSocket.instances[0]!.readyState).toBe(MockWebSocket.CONNECTING);

      wsTransport.probeLiveness();

      expect(MockWebSocket.instances).toHaveLength(1);
    });
  });
});
