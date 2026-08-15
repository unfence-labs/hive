import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceLiveData } from "@/hooks/useWorkspaceLiveData";
import type { WsOutgoing } from "@/types";

vi.mock("@/lib/ws-transport", () => {
  const messageHandlers = new Map<string, Set<(msg: WsOutgoing) => void>>();

  const getSet = (workspaceId: string) => {
    const existing = messageHandlers.get(workspaceId);
    if (existing) return existing;
    const created = new Set<(msg: WsOutgoing) => void>();
    messageHandlers.set(workspaceId, created);
    return created;
  };

  const wsTransport = {
    onMessage: vi.fn((workspaceId: string, handler: (msg: WsOutgoing) => void) => {
      getSet(workspaceId).add(handler);
      return {
        unsubscribe: () => { getSet(workspaceId).delete(handler); },
        hadBufferedMessages: false,
      };
    }),
    onReconnect: vi.fn(() => () => {}),
  };

  const __wsMock = {
    emit: (workspaceId: string, msg: WsOutgoing) => {
      for (const handler of messageHandlers.get(workspaceId) ?? []) handler(msg);
    },
    reset: () => {
      messageHandlers.clear();
      wsTransport.onMessage.mockClear();
    },
    handlerCount: (workspaceId: string) => {
      return messageHandlers.get(workspaceId)?.size ?? 0;
    },
  };

  return { wsTransport, __wsMock };
});

const getWsMock = async () =>
  (await import("@/lib/ws-transport")) as unknown as {
    wsTransport: { onMessage: ReturnType<typeof vi.fn> };
    __wsMock: {
      emit: (workspaceId: string, msg: WsOutgoing) => void;
      reset: () => void;
      handlerCount: (workspaceId: string) => number;
    };
  };

describe("useWorkspaceLiveData", () => {
  beforeEach(async () => {
    const { __wsMock } = await getWsMock();
    __wsMock.reset();
  });

  it("returns empty object initially for given workspace IDs", () => {
    const { result } = renderHook(() => useWorkspaceLiveData(["ws-1", "ws-2"]));
    expect(result.current).toEqual({});
  });

  it("replaces unread sessions from authoritative unread_state events", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useWorkspaceLiveData(["ws-1"]));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "unread_state",
        sessions: [
          {
            sessionId: "sess-1",
            assistantMessageCount: 4,
            readAssistantMessageCount: 1,
          },
          {
            sessionId: "sess-2",
            assistantMessageCount: 2,
            readAssistantMessageCount: 0,
          },
        ],
      });
    });

    expect(result.current["ws-1"]?.unreadSessions).toEqual({
      "sess-1": {
        sessionId: "sess-1",
        assistantMessageCount: 4,
        readAssistantMessageCount: 1,
      },
      "sess-2": {
        sessionId: "sess-2",
        assistantMessageCount: 2,
        readAssistantMessageCount: 0,
      },
    });

    act(() => {
      __wsMock.emit("ws-1", {
        type: "unread_state",
        sessions: [
          {
            sessionId: "sess-2",
            assistantMessageCount: 3,
            readAssistantMessageCount: 0,
          },
        ],
      });
    });

    expect(result.current["ws-1"]?.unreadSessions).toEqual({
      "sess-2": {
        sessionId: "sess-2",
        assistantMessageCount: 3,
        readAssistantMessageCount: 0,
      },
    });

    act(() => {
      __wsMock.emit("ws-1", { type: "unread_state", sessions: [] });
    });

    expect(result.current["ws-1"]?.unreadSessions).toBeUndefined();
  });

  it("updates status on WS status message", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useWorkspaceLiveData(["ws-1"]));

    act(() => {
      __wsMock.emit("ws-1", { type: "status", status: "busy", streaming: true });
    });

    expect(result.current["ws-1"]).toEqual({ status: "busy", streaming: true, streamingSessions: {} });

    act(() => {
      __wsMock.emit("ws-1", { type: "status", status: "idle", streaming: false });
    });

    expect(result.current["ws-1"]).toEqual({ status: "idle", streaming: false, streamingSessions: {} });
  });

  it("tracks multiple streaming sessions even when workspace status stays busy", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useWorkspaceLiveData(["ws-1"]));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "status",
        status: "busy",
        sessionId: "sess-a",
        streaming: true,
      });
    });

    expect(result.current["ws-1"]).toEqual({
      status: "busy",
      streaming: true,
      streamingSessions: { "sess-a": true },
    });

    act(() => {
      __wsMock.emit("ws-1", {
        type: "status",
        status: "busy",
        sessionId: "sess-b",
        streaming: true,
      });
    });

    expect(result.current["ws-1"]).toEqual({
      status: "busy",
      streaming: true,
      streamingSessions: { "sess-a": true, "sess-b": true },
    });
  });

  it("removes one session from streaming map without clearing other active sessions", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useWorkspaceLiveData(["ws-1"]));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "status",
        status: "busy",
        sessionId: "sess-a",
        streaming: true,
      });
      __wsMock.emit("ws-1", {
        type: "status",
        status: "busy",
        sessionId: "sess-b",
        streaming: true,
      });
    });

    act(() => {
      __wsMock.emit("ws-1", {
        type: "status",
        status: "busy",
        sessionId: "sess-a",
        streaming: false,
      });
    });

    expect(result.current["ws-1"]).toEqual({
      status: "busy",
      streaming: true,
      streamingSessions: { "sess-b": true },
    });
  });

  it("keeps unread session data even when that session starts streaming again", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useWorkspaceLiveData(["ws-1"]));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "unread_state",
        sessions: [{
          sessionId: "sess-a",
          assistantMessageCount: 2,
          readAssistantMessageCount: 1,
        }],
      });
      __wsMock.emit("ws-1", {
        type: "status",
        status: "busy",
        sessionId: "sess-a",
        streaming: true,
      });
    });

    expect(result.current["ws-1"]?.unreadSessions).toEqual({
      "sess-a": {
        sessionId: "sess-a",
        assistantMessageCount: 2,
        readAssistantMessageCount: 1,
      },
    });
    expect(result.current["ws-1"]?.streamingSessions).toEqual({ "sess-a": true });
  });

  it("updates branch on WS branch_info message", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useWorkspaceLiveData(["ws-1"]));

    const branchInfo = { name: "workspace/tokyo", lastSyncedAt: "2026-02-13T00:00:00.000Z" };

    act(() => {
      __wsMock.emit("ws-1", { type: "branch_info", info: branchInfo });
    });

    expect(result.current["ws-1"]).toEqual({
      branch: "workspace/tokyo",
      branchInfo,
    });
  });

  it("does NOT update state when same branch name is received again", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useWorkspaceLiveData(["ws-1"]));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "branch_info",
        info: { name: "workspace/tokyo", lastSyncedAt: "2026-02-13T00:00:00.000Z" },
      });
    });

    const firstReference = result.current;

    act(() => {
      __wsMock.emit("ws-1", {
        type: "branch_info",
        info: { name: "workspace/tokyo", lastSyncedAt: "2026-02-13T01:00:00.000Z" },
      });
    });

    expect(result.current).toBe(firstReference);
  });

  it("cleans up stale entries when workspace IDs change", async () => {
    const { __wsMock } = await getWsMock();
    const { result, rerender } = renderHook(
      (ids: string[]) => useWorkspaceLiveData(ids),
      { initialProps: ["ws-1", "ws-2"] },
    );

    act(() => {
      __wsMock.emit("ws-1", { type: "status", status: "busy", streaming: false });
      __wsMock.emit("ws-2", { type: "status", status: "idle", streaming: false });
    });

    expect(result.current["ws-1"]).toBeDefined();
    expect(result.current["ws-2"]).toBeDefined();

    rerender(["ws-1"]);

    expect(result.current["ws-1"]).toBeDefined();
    expect(result.current["ws-2"]).toBeUndefined();
  });

  it("unsubscribes handlers on unmount", async () => {
    const { __wsMock } = await getWsMock();
    const { unmount } = renderHook(() => useWorkspaceLiveData(["ws-1"]));

    expect(__wsMock.handlerCount("ws-1")).toBe(1);

    unmount();

    expect(__wsMock.handlerCount("ws-1")).toBe(0);
  });

  it("sets scriptRunning on script_status running message", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useWorkspaceLiveData(["ws-1"]));

    act(() => {
      __wsMock.emit("ws-1", { type: "script_status", scriptType: "run", state: "running" });
    });

    expect(result.current["ws-1"]?.scriptRunning).toBe(true);
    expect(result.current["ws-1"]?.scriptStates).toEqual({ run: "running" });
  });

  it("clears scriptRunning when script finishes", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useWorkspaceLiveData(["ws-1"]));

    act(() => {
      __wsMock.emit("ws-1", { type: "script_status", scriptType: "run", state: "running" });
    });
    expect(result.current["ws-1"]?.scriptRunning).toBe(true);

    act(() => {
      __wsMock.emit("ws-1", { type: "script_status", scriptType: "run", state: "done", exitCode: 0 });
    });
    expect(result.current["ws-1"]?.scriptRunning).toBe(false);
    expect(result.current["ws-1"]?.scriptStates).toEqual({ run: "done" });
  });

  it("stays scriptRunning while at least one script type is running", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useWorkspaceLiveData(["ws-1"]));

    act(() => {
      __wsMock.emit("ws-1", { type: "script_status", scriptType: "setup", state: "running" });
      __wsMock.emit("ws-1", { type: "script_status", scriptType: "run", state: "running" });
    });
    expect(result.current["ws-1"]?.scriptRunning).toBe(true);

    act(() => {
      __wsMock.emit("ws-1", { type: "script_status", scriptType: "setup", state: "done", exitCode: 0 });
    });
    // run is still running
    expect(result.current["ws-1"]?.scriptRunning).toBe(true);

    act(() => {
      __wsMock.emit("ws-1", { type: "script_status", scriptType: "run", state: "error", exitCode: 1 });
    });
    expect(result.current["ws-1"]?.scriptRunning).toBe(false);
  });

  it("computes scriptRunning for arbitrary named scripts", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useWorkspaceLiveData(["ws-1"]));

    act(() => {
      __wsMock.emit("ws-1", { type: "script_status", scriptType: "backend", state: "running" });
      __wsMock.emit("ws-1", { type: "script_status", scriptType: "frontend", state: "done", exitCode: 0 });
    });

    expect(result.current["ws-1"]?.scriptRunning).toBe(true);
    expect(result.current["ws-1"]?.scriptStates).toEqual({
      backend: "running",
      frontend: "done",
    });

    act(() => {
      __wsMock.emit("ws-1", { type: "script_status", scriptType: "backend", state: "error", exitCode: 1 });
    });

    expect(result.current["ws-1"]?.scriptRunning).toBe(false);
    expect(result.current["ws-1"]?.scriptStates).toEqual({
      backend: "error",
      frontend: "done",
    });
  });

  it("tracks and clears browser session status", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useWorkspaceLiveData(["ws-1"]));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "browser_status",
        status: {
          sessionId: "sess-a",
          state: "active",
          streaming: true,
          streamPath: "/ws/browser/ws-1/sess-a",
          updatedAt: 1,
        },
      });
    });

    expect(result.current["ws-1"]?.browserSessions).toEqual({
      "sess-a": {
        sessionId: "sess-a",
        state: "active",
        streaming: true,
        streamPath: "/ws/browser/ws-1/sess-a",
        updatedAt: 1,
      },
    });

    act(() => {
      __wsMock.emit("ws-1", {
        type: "browser_status",
        status: {
          sessionId: "sess-a",
          state: "closed",
          updatedAt: 2,
        },
      });
    });

    expect(result.current["ws-1"]?.browserSessions).toBeUndefined();
  });

  it("does not re-render when same script_status is emitted twice", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useWorkspaceLiveData(["ws-1"]));

    act(() => {
      __wsMock.emit("ws-1", { type: "script_status", scriptType: "run", state: "running" });
    });

    const firstRef = result.current;

    act(() => {
      __wsMock.emit("ws-1", { type: "script_status", scriptType: "run", state: "running" });
    });

    expect(result.current).toBe(firstRef);
  });

  it("handles multiple workspaces independently", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useWorkspaceLiveData(["ws-1", "ws-2"]));

    act(() => {
      __wsMock.emit("ws-1", { type: "status", status: "busy", streaming: true });
    });

    expect(result.current["ws-1"]).toEqual({ status: "busy", streaming: true, streamingSessions: {} });
    expect(result.current["ws-2"]).toBeUndefined();

    act(() => {
      __wsMock.emit("ws-2", {
        type: "branch_info",
        info: { name: "workspace/kyoto", lastSyncedAt: "2026-02-13T00:00:00.000Z" },
      });
    });

    expect(result.current["ws-1"]).toEqual({ status: "busy", streaming: true, streamingSessions: {} });
    expect(result.current["ws-2"]).toEqual({
      branch: "workspace/kyoto",
      branchInfo: { name: "workspace/kyoto", lastSyncedAt: "2026-02-13T00:00:00.000Z" },
    });
  });

  it("clears streamingSessions on done event", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useWorkspaceLiveData(["ws-1"]));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "status",
        status: "busy",
        sessionId: "sess-a",
        streaming: true,
      });
    });

    expect(result.current["ws-1"]?.streaming).toBe(true);
    expect(result.current["ws-1"]?.streamingSessions).toEqual({ "sess-a": true });

    act(() => {
      __wsMock.emit("ws-1", { type: "done", sessionId: "sess-a" });
    });

    expect(result.current["ws-1"]?.streaming).toBe(false);
    expect(result.current["ws-1"]?.streamingSessions).toEqual({});
    expect(result.current["ws-1"]?.unreadSessions).toBeUndefined();
  });

  it("clears streamingSessions on cancelled event", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useWorkspaceLiveData(["ws-1"]));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "status",
        status: "busy",
        sessionId: "sess-a",
        streaming: true,
      });
    });

    expect(result.current["ws-1"]?.streaming).toBe(true);

    act(() => {
      __wsMock.emit("ws-1", { type: "cancelled", sessionId: "sess-a" });
    });

    expect(result.current["ws-1"]?.streaming).toBe(false);
    expect(result.current["ws-1"]?.streamingSessions).toEqual({});
    expect(result.current["ws-1"]?.unreadSessions).toBeUndefined();
  });

  it("keeps other sessions streaming when one session receives done", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useWorkspaceLiveData(["ws-1"]));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "status",
        status: "busy",
        sessionId: "sess-a",
        streaming: true,
      });
      __wsMock.emit("ws-1", {
        type: "status",
        status: "busy",
        sessionId: "sess-b",
        streaming: true,
      });
    });

    expect(result.current["ws-1"]?.streaming).toBe(true);

    act(() => {
      __wsMock.emit("ws-1", { type: "done", sessionId: "sess-a" });
    });

    expect(result.current["ws-1"]?.streaming).toBe(true);
    expect(result.current["ws-1"]?.streamingSessions).toEqual({ "sess-b": true });
  });

});
