import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useSessionMessages,
  sessionMessagesKey,
  getCachedSessionMessages,
  appendCachedSessionMessage,
  invalidateSessionMessages,
  removeCachedSessionMessages,
} from "@/hooks/useSessionMessages";
import type { ChatMessage } from "@/types";

vi.mock("@/hooks/useApi", () => {
  const getMock = vi.fn(() => Promise.resolve<ChatMessage[]>([]));
  return {
    api: { get: getMock },
    __apiMock: {
      getMock,
      reset: () => {
        getMock.mockReset();
        getMock.mockImplementation(() => Promise.resolve<ChatMessage[]>([]));
      },
    },
  };
});

const getApiMock = async () =>
  (await import("@/hooks/useApi")) as unknown as {
    __apiMock: { getMock: ReturnType<typeof vi.fn>; reset: () => void };
  };

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
}

function wrapperFor(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function message(id: string, content: string): ChatMessage {
  return {
    id,
    sessionId: "sess-1",
    role: "assistant",
    content,
    timestamp: "2026-02-20T00:00:00.000Z",
  };
}

function userMessage(id: string, content: string): ChatMessage {
  return {
    id,
    sessionId: "sess-1",
    role: "user",
    content,
    timestamp: "2026-02-20T00:00:00.000Z",
  };
}

describe("useSessionMessages", () => {
  beforeEach(async () => {
    const { __apiMock } = await getApiMock();
    __apiMock.reset();
  });

  it("fetches the session messages once a sessionId is provided", async () => {
    const { __apiMock } = await getApiMock();
    __apiMock.getMock.mockResolvedValue([message("a1", "loaded")]);

    const queryClient = newClient();
    const { result } = renderHook(() => useSessionMessages("ws-1", "sess-1"), {
      wrapper: wrapperFor(queryClient),
    });

    await waitFor(() => {
      expect(result.current.messages).toEqual([message("a1", "loaded")]);
    });
    expect(__apiMock.getMock).toHaveBeenCalledWith("/api/workspaces/ws-1/sessions/sess-1/messages");
  });

  it("returns an empty list and does not fetch when there is no sessionId", async () => {
    const { __apiMock } = await getApiMock();
    const queryClient = newClient();
    const { result } = renderHook(() => useSessionMessages("ws-1", undefined), {
      wrapper: wrapperFor(queryClient),
    });

    expect(result.current.messages).toEqual([]);
    expect(__apiMock.getMock).not.toHaveBeenCalled();
  });

  it("does not fetch when there is no workspaceId", async () => {
    const { __apiMock } = await getApiMock();
    const queryClient = newClient();
    renderHook(() => useSessionMessages(undefined, "sess-1"), {
      wrapper: wrapperFor(queryClient),
    });

    expect(__apiMock.getMock).not.toHaveBeenCalled();
  });

  it("sessionMessagesKey normalizes missing ids to empty strings", () => {
    expect(sessionMessagesKey("ws-1", "sess-1")).toEqual(["session-messages", "ws-1", "sess-1"]);
    expect(sessionMessagesKey(undefined, undefined)).toEqual(["session-messages", "", ""]);
  });

  it("preserves cached user echoes when a stale REST refetch starts after the echo was cached", async () => {
    const { __apiMock } = await getApiMock();
    const firstUser = userMessage("u1", "first prompt");
    const firstAssistant = message("a1", "first answer");
    const followUp = userMessage("u2", "queued follow-up");
    __apiMock.getMock.mockResolvedValue([firstUser, firstAssistant]);

    const queryClient = newClient();
    const key = sessionMessagesKey("ws-1", "sess-1");
    queryClient.setQueryData(key, [firstUser, firstAssistant, followUp]);

    const { result } = renderHook(() => useSessionMessages("ws-1", "sess-1"), {
      wrapper: wrapperFor(queryClient),
    });

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: key });
    });

    expect(__apiMock.getMock).toHaveBeenCalledWith("/api/workspaces/ws-1/sessions/sess-1/messages");
    expect(result.current.messages).toEqual([firstUser, firstAssistant, followUp]);
  });

  describe("appendCachedSessionMessage", () => {
    it("appends a message to the session cache", () => {
      const queryClient = newClient();
      appendCachedSessionMessage(queryClient, "ws-1", "sess-1", message("a1", "first"));
      appendCachedSessionMessage(queryClient, "ws-1", "sess-1", message("a2", "second"));

      expect(getCachedSessionMessages(queryClient, "ws-1", "sess-1")).toEqual([
        message("a1", "first"),
        message("a2", "second"),
      ]);
    });

    it("dedups by message id", () => {
      const queryClient = newClient();
      appendCachedSessionMessage(queryClient, "ws-1", "sess-1", message("a1", "first"));
      appendCachedSessionMessage(queryClient, "ws-1", "sess-1", message("a1", "duplicate"));

      const cached = getCachedSessionMessages(queryClient, "ws-1", "sess-1");
      expect(cached).toHaveLength(1);
      expect(cached?.[0]?.content).toBe("first");
    });

    it("is a no-op without a workspaceId or sessionId", () => {
      const queryClient = newClient();
      appendCachedSessionMessage(queryClient, undefined, "sess-1", message("a1", "x"));
      appendCachedSessionMessage(queryClient, "ws-1", undefined, message("a1", "x"));

      expect(getCachedSessionMessages(queryClient, "ws-1", "sess-1")).toBeUndefined();
    });
  });

  describe("getCachedSessionMessages", () => {
    it("reads the cached messages synchronously without fetching", () => {
      const queryClient = newClient();
      queryClient.setQueryData(sessionMessagesKey("ws-1", "sess-1"), [message("a1", "cached")]);

      expect(getCachedSessionMessages(queryClient, "ws-1", "sess-1")).toEqual([message("a1", "cached")]);
      expect(getCachedSessionMessages(queryClient, "ws-1", "other")).toBeUndefined();
    });
  });

  describe("invalidateSessionMessages", () => {
    it("marks the session query stale", async () => {
      const queryClient = newClient();
      queryClient.setQueryData(sessionMessagesKey("ws-1", "sess-1"), [message("a1", "cached")]);

      const state = queryClient.getQueryState(sessionMessagesKey("ws-1", "sess-1"));
      expect(state?.isInvalidated).toBe(false);

      invalidateSessionMessages(queryClient, "ws-1", "sess-1");

      await waitFor(() => {
        const next = queryClient.getQueryState(sessionMessagesKey("ws-1", "sess-1"));
        expect(next?.isInvalidated).toBe(true);
      });
    });

    it("is a no-op without a workspaceId or sessionId", () => {
      const queryClient = newClient();
      const spy = vi.spyOn(queryClient, "invalidateQueries");
      invalidateSessionMessages(queryClient, undefined, "sess-1");
      invalidateSessionMessages(queryClient, "ws-1", undefined);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("removeCachedSessionMessages", () => {
    it("clears a specific session's cache", () => {
      const queryClient = newClient();
      queryClient.setQueryData(sessionMessagesKey("ws-1", "sess-1"), [message("a1", "x")]);

      removeCachedSessionMessages(queryClient, "ws-1", "sess-1");

      expect(getCachedSessionMessages(queryClient, "ws-1", "sess-1")).toBeUndefined();
    });

    it("clears every session in a workspace when no sessionId is given", () => {
      const queryClient = newClient();
      queryClient.setQueryData(sessionMessagesKey("ws-1", "sess-1"), [message("a1", "x")]);
      queryClient.setQueryData(sessionMessagesKey("ws-1", "sess-2"), [message("a2", "y")]);

      removeCachedSessionMessages(queryClient, "ws-1");

      expect(getCachedSessionMessages(queryClient, "ws-1", "sess-1")).toBeUndefined();
      expect(getCachedSessionMessages(queryClient, "ws-1", "sess-2")).toBeUndefined();
    });
  });
});
