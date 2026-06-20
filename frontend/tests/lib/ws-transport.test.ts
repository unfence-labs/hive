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

  it("tracks the per-session render window and clears it with clearCachedData", () => {
    wsTransport.connect("ws-1");
    const socket = MockWebSocket.instances[0]!;
    socket.open();

    expect(wsTransport.getSessionWindow("ws-1", "sess-1")).toBeUndefined();

    wsTransport.setSessionWindow("ws-1", "sess-1", {
      messages: [
        {
          id: "m1",
          sessionId: "sess-1",
          role: "user",
          content: "cached",
          timestamp: "2026-02-20T00:00:00.000Z",
        },
      ],
      hasMore: false,
    });
    expect(wsTransport.getSessionWindow("ws-1", "sess-1")?.messages).toHaveLength(1);

    wsTransport.clearCachedData("ws-1");
    expect(wsTransport.getSessionWindow("ws-1", "sess-1")).toBeUndefined();
  });

  it("drops the session window after disconnectAll removes subscriptions", () => {
    wsTransport.connect("ws-1");
    const socket = MockWebSocket.instances[0]!;
    socket.open();

    wsTransport.setSessionWindow("ws-1", "sess-1", { messages: [], hasMore: false });
    expect(wsTransport.getSessionWindow("ws-1", "sess-1")).toBeDefined();

    wsTransport.disconnectAll();
    expect(wsTransport.getSessionWindow("ws-1", "sess-1")).toBeUndefined();
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

  it("delivers stream_snapshot events to message handlers (live catch-up)", () => {
    wsTransport.connect("ws-1");
    const socket = MockWebSocket.instances[0]!;
    socket.open();

    const received: WsOutgoing[] = [];
    const { unsubscribe } = wsTransport.onMessage("ws-1", (msg) => received.push(msg));

    const snapshot: WsOutgoing = {
      type: "stream_snapshot",
      sessionId: "s1",
      text: "live",
      thinking: "",
      toolCalls: [],
      agentActivities: [],
      planMode: false,
      streamingStartedAt: 1_700_000_000_000,
    };
    socket.hubMessage("ws-1", snapshot);

    expect(received).toContainEqual(snapshot);
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

  it("sends sync_workspaces BEFORE firing reconnect listeners", () => {
    wsTransport.connect("ws-1");
    const first = MockWebSocket.instances[0]!;
    first.open();

    // The reconnect listener (which re-sends switch_session) must only fire after
    // the subscription is on the wire, so the on-the-wire order is
    // sync_workspaces → switch_session and the backend never sees "Not subscribed".
    let syncSeenWhenReconnectFired: string[][] | null = null;
    wsTransport.onReconnect("ws-1", () => {
      syncSeenWhenReconnectFired = getSyncMessages(MockWebSocket.instances[1]!);
    });

    first.close();
    vi.advanceTimersByTime(1000);
    const second = MockWebSocket.instances[1]!;
    second.open();

    // At the instant the reconnect listener fired, the post-reconnect sync had
    // already been sent on the new socket.
    expect(syncSeenWhenReconnectFired).not.toBeNull();
    expect(syncSeenWhenReconnectFired!).toEqual([expect.arrayContaining(["ws-1"])]);
  });

  it("does not fire reconnect listeners on the initial (non-reconnect) open", () => {
    const reconnect = vi.fn();
    wsTransport.connect("ws-1");
    wsTransport.onReconnect("ws-1", reconnect);
    MockWebSocket.instances[0]!.open();

    expect(reconnect).not.toHaveBeenCalled();
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

  it("replays cached status and buffered messages to newly attached handlers (history is not cached)", () => {
    wsTransport.connect("ws-1");
    const socket = MockWebSocket.instances[0]!;
    socket.open();

    const firstHandler: WsOutgoing[] = [];
    const { unsubscribe } = wsTransport.onMessage("ws-1", (msg) => {
      firstHandler.push(msg);
    });

    socket.hubMessage("ws-1", { type: "status", status: "busy", streaming: true });
    socket.hubMessage("ws-1", { type: "text_delta", sessionId: "s1", text: "partial" });
    socket.hubMessage("ws-1", { type: "done", sessionId: "s1", messageId: "a1" });

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
    socket.hubMessage("ws-1", { type: "done", sessionId: "s1", messageId: "a2" });

    const replayed: WsOutgoing[] = [];
    const result = wsTransport.onMessage("ws-1", (msg) => {
      replayed.push(msg);
    });

    expect(result.hadBufferedMessages).toBe(true);
    expect(replayed).toEqual([
      // Cached status only — history lives in REST, never replayed over the socket.
      { type: "status", status: "busy", streaming: true },
      // Buffered live messages
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
      { type: "done", sessionId: "s1", messageId: "a2" },
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
    socket.hubMessage("ws-1", { type: "done", sessionId: "s-old", messageId: "old-1" });
    socket.hubMessage("ws-1", { type: "text_delta", sessionId: "s-new", text: "fresh" });
    socket.hubMessage("ws-1", { type: "done", sessionId: "s-new", messageId: "new-1" });

    const replayed: WsOutgoing[] = [];
    const result = wsTransport.onMessage("ws-1", (msg) => replayed.push(msg));

    expect(result.hadBufferedMessages).toBe(true);
    expect(replayed).toEqual([
      { type: "status", status: "busy", streaming: true, sessionId: "s-new" },
      { type: "text_delta", sessionId: "s-old", text: "stale" },
      { type: "done", sessionId: "s-old", messageId: "old-1" },
      { type: "text_delta", sessionId: "s-new", text: "fresh" },
      { type: "done", sessionId: "s-new", messageId: "new-1" },
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

    it("replays branch_info together with status and diff_stats (not history)", () => {
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
      // History is owned by REST and never replayed over the socket.
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
    it("clears cached status, window, and message buffer", () => {
      wsTransport.connect("ws-1");
      const socket = MockWebSocket.instances[0]!;
      socket.open();

      const first: WsOutgoing[] = [];
      const { unsubscribe } = wsTransport.onMessage("ws-1", (msg) => first.push(msg));
      socket.hubMessage("ws-1", { type: "status", status: "busy", streaming: true });
      unsubscribe();

      wsTransport.setSessionWindow("ws-1", "s1", { messages: [], hasMore: false });
      socket.hubMessage("ws-1", { type: "text_delta", sessionId: "s1", text: "buffered" });

      wsTransport.clearCachedData("ws-1");

      expect(wsTransport.getSessionWindow("ws-1", "s1")).toBeUndefined();
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

  describe("session window cache", () => {
    it("round-trips a per-session window via set/getSessionWindow", () => {
      wsTransport.connect("ws-1");
      MockWebSocket.instances[0]!.open();

      const window = {
        messages: [
          { id: "m1", sessionId: "s1", role: "user" as const, content: "hi", timestamp: "2026-02-20T00:00:00.000Z" },
        ],
        hasMore: true,
      };
      wsTransport.setSessionWindow("ws-1", "s1", window);

      const read = wsTransport.getSessionWindow("ws-1", "s1");
      expect(read).toEqual(window);
    });

    it("keeps windows separate per session", () => {
      wsTransport.connect("ws-1");
      MockWebSocket.instances[0]!.open();

      wsTransport.setSessionWindow("ws-1", "s1", { messages: [], hasMore: false });
      wsTransport.setSessionWindow("ws-1", "s2", { messages: [], hasMore: true });

      expect(wsTransport.getSessionWindow("ws-1", "s1")?.hasMore).toBe(false);
      expect(wsTransport.getSessionWindow("ws-1", "s2")?.hasMore).toBe(true);
    });

    it("getSessionWindow returns undefined when none is cached", () => {
      wsTransport.connect("ws-1");
      MockWebSocket.instances[0]!.open();
      expect(wsTransport.getSessionWindow("ws-1", "s1")).toBeUndefined();
    });

    it("setSessionWindow is a no-op for an unknown workspace", () => {
      wsTransport.setSessionWindow("unknown", "s1", { messages: [], hasMore: false });
      expect(wsTransport.getSessionWindow("unknown", "s1")).toBeUndefined();
    });

    it("does not expose any legacy history-cache API", () => {
      // Guard against re-introducing the removed lastHistory cache.
      expect((wsTransport as unknown as Record<string, unknown>).updateCachedHistory).toBeUndefined();
      expect((wsTransport as unknown as Record<string, unknown>).hasCachedHistory).toBeUndefined();
    });
  });
});
