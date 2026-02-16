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

  it("updates state when branch_info includes PR data", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useWorkspaceLiveData(["ws-1"]));

    const branchInfo = {
      name: "workspace/tokyo",
      lastSyncedAt: "2026-02-15T00:00:00.000Z",
      pr: {
        number: 42,
        url: "https://github.com/acme/widget/pull/42",
        state: "open" as const,
        mergeable: true,
        mergeableState: "clean" as const,
        checksStatus: "success" as const,
      },
    };

    act(() => {
      __wsMock.emit("ws-1", { type: "branch_info", info: branchInfo });
    });

    expect(result.current["ws-1"]?.branch).toBe("workspace/tokyo");
    expect(result.current["ws-1"]?.branchInfo?.pr?.number).toBe(42);
    expect(result.current["ws-1"]?.branchInfo?.pr?.state).toBe("open");
    expect(result.current["ws-1"]?.branchInfo?.pr?.mergeable).toBe(true);
  });

  it("updates state when PR number changes", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useWorkspaceLiveData(["ws-1"]));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "branch_info",
        info: {
          name: "workspace/tokyo",
          lastSyncedAt: "2026-02-15T00:00:00.000Z",
          pr: {
            number: 42,
            url: "https://github.com/acme/widget/pull/42",
            state: "open" as const,
            mergeable: null,
            mergeableState: "unknown" as const,
            checksStatus: "pending" as const,
          },
        },
      });
    });

    const firstRef = result.current;

    act(() => {
      __wsMock.emit("ws-1", {
        type: "branch_info",
        info: {
          name: "workspace/tokyo",
          lastSyncedAt: "2026-02-15T01:00:00.000Z",
          pr: {
            number: 43,
            url: "https://github.com/acme/widget/pull/43",
            state: "open" as const,
            mergeable: null,
            mergeableState: "unknown" as const,
            checksStatus: "pending" as const,
          },
        },
      });
    });

    // Should have updated because PR number changed
    expect(result.current).not.toBe(firstRef);
    expect(result.current["ws-1"]?.branchInfo?.pr?.number).toBe(43);
  });

  it("updates state when PR state changes (open -> merged)", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useWorkspaceLiveData(["ws-1"]));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "branch_info",
        info: {
          name: "workspace/tokyo",
          lastSyncedAt: "2026-02-15T00:00:00.000Z",
          pr: {
            number: 42,
            url: "https://github.com/acme/widget/pull/42",
            state: "open" as const,
            mergeable: true,
            mergeableState: "clean" as const,
            checksStatus: "success" as const,
          },
        },
      });
    });

    const firstRef = result.current;

    act(() => {
      __wsMock.emit("ws-1", {
        type: "branch_info",
        info: {
          name: "workspace/tokyo",
          lastSyncedAt: "2026-02-15T02:00:00.000Z",
          pr: {
            number: 42,
            url: "https://github.com/acme/widget/pull/42",
            state: "merged" as const,
            mergeable: true,
            mergeableState: "clean" as const,
            checksStatus: "success" as const,
          },
        },
      });
    });

    expect(result.current).not.toBe(firstRef);
    expect(result.current["ws-1"]?.branchInfo?.pr?.state).toBe("merged");
  });

  it("updates state when checksStatus changes", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useWorkspaceLiveData(["ws-1"]));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "branch_info",
        info: {
          name: "workspace/tokyo",
          lastSyncedAt: "2026-02-15T00:00:00.000Z",
          pr: {
            number: 42,
            url: "https://github.com/acme/widget/pull/42",
            state: "open" as const,
            mergeable: null,
            mergeableState: "unknown" as const,
            checksStatus: "pending" as const,
          },
        },
      });
    });

    const firstRef = result.current;

    act(() => {
      __wsMock.emit("ws-1", {
        type: "branch_info",
        info: {
          name: "workspace/tokyo",
          lastSyncedAt: "2026-02-15T01:00:00.000Z",
          pr: {
            number: 42,
            url: "https://github.com/acme/widget/pull/42",
            state: "open" as const,
            mergeable: null,
            mergeableState: "unknown" as const,
            checksStatus: "failure" as const,
          },
        },
      });
    });

    expect(result.current).not.toBe(firstRef);
    expect(result.current["ws-1"]?.branchInfo?.pr?.checksStatus).toBe("failure");
  });

  it("does NOT update when all PR fields are identical (only lastSyncedAt differs)", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useWorkspaceLiveData(["ws-1"]));

    const prData = {
      number: 42,
      url: "https://github.com/acme/widget/pull/42",
      state: "open" as const,
      mergeable: true,
      mergeableState: "clean" as const,
      checksStatus: "success" as const,
    };

    act(() => {
      __wsMock.emit("ws-1", {
        type: "branch_info",
        info: { name: "workspace/tokyo", lastSyncedAt: "2026-02-15T00:00:00.000Z", pr: prData },
      });
    });

    const firstRef = result.current;

    act(() => {
      __wsMock.emit("ws-1", {
        type: "branch_info",
        info: { name: "workspace/tokyo", lastSyncedAt: "2026-02-15T01:00:00.000Z", pr: prData },
      });
    });

    // Should be the same reference — no re-render
    expect(result.current).toBe(firstRef);
  });

  it("updates state when prSyncError appears", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useWorkspaceLiveData(["ws-1"]));

    act(() => {
      __wsMock.emit("ws-1", {
        type: "branch_info",
        info: { name: "workspace/tokyo", lastSyncedAt: "2026-02-15T00:00:00.000Z" },
      });
    });

    const firstRef = result.current;

    act(() => {
      __wsMock.emit("ws-1", {
        type: "branch_info",
        info: {
          name: "workspace/tokyo",
          lastSyncedAt: "2026-02-15T01:00:00.000Z",
          prSyncError: "gh CLI not installed",
        },
      });
    });

    expect(result.current).not.toBe(firstRef);
    expect(result.current["ws-1"]?.branchInfo?.prSyncError).toBe("gh CLI not installed");
  });

  it("updates state when PR transitions from null to present", async () => {
    const { __wsMock } = await getWsMock();
    const { result } = renderHook(() => useWorkspaceLiveData(["ws-1"]));

    // Initially no PR
    act(() => {
      __wsMock.emit("ws-1", {
        type: "branch_info",
        info: { name: "workspace/tokyo", lastSyncedAt: "2026-02-15T00:00:00.000Z", pr: null },
      });
    });

    const firstRef = result.current;

    // PR appears
    act(() => {
      __wsMock.emit("ws-1", {
        type: "branch_info",
        info: {
          name: "workspace/tokyo",
          lastSyncedAt: "2026-02-15T01:00:00.000Z",
          pr: {
            number: 42,
            url: "https://github.com/acme/widget/pull/42",
            state: "open" as const,
            mergeable: null,
            mergeableState: "unknown" as const,
            checksStatus: "pending" as const,
          },
        },
      });
    });

    expect(result.current).not.toBe(firstRef);
    expect(result.current["ws-1"]?.branchInfo?.pr?.number).toBe(42);
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
});
