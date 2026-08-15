import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessions } from "@/hooks/useSessions";
import { api } from "@/hooks/useApi";
import { createWrapper } from "../test-utils";
import type { SessionMetadata } from "@/types";

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

function makeSession(
  id: string,
  workspaceId = "ws-1",
  createdAt = "2026-02-12T00:00:00.000Z",
): SessionMetadata {
  return {
    sessionId: id,
    workspaceId,
    createdAt,
    updatedAt: "2026-02-12T00:00:01.000Z",
    assistantMessageCount: 0,
    readAssistantMessageCount: 0,
  };
}

describe("useSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches sessions on mount for a workspace", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([makeSession("sess-1")]);
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useSessions("ws-1"), { wrapper });

    await waitFor(() => {
      expect(result.current.sessions).toEqual([makeSession("sess-1")]);
    });
    expect(api.get).toHaveBeenCalledWith("/api/workspaces/ws-1/sessions");
    expect(result.current.loading).toBe(false);
  });

  it("sorts sessions by createdAt ascending on initial fetch", async () => {
    const newest = makeSession("sess-newest", "ws-1", "2026-02-12T00:00:03.000Z");
    const oldest = makeSession("sess-oldest", "ws-1", "2026-02-12T00:00:01.000Z");
    const middle = makeSession("sess-middle", "ws-1", "2026-02-12T00:00:02.000Z");

    vi.mocked(api.get).mockResolvedValueOnce([newest, oldest, middle]);
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useSessions("ws-1"), { wrapper });

    await waitFor(() => {
      expect(result.current.sessions.map((s) => s.sessionId)).toEqual([
        "sess-oldest",
        "sess-middle",
        "sess-newest",
      ]);
    });
  });

  it("stays empty and skips API calls when workspace is undefined", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSessions(undefined), { wrapper });

    await waitFor(() => {
      expect(result.current.sessions).toEqual([]);
    });
    expect(api.get).not.toHaveBeenCalled();

    await act(async () => {
      expect(await result.current.createSession()).toBeNull();
      expect(await result.current.deleteSession("sess-1")).toBe(false);
    });

    expect(api.post).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it("creates a session then refreshes the list", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce([makeSession("sess-1")])
      .mockResolvedValueOnce([makeSession("sess-1"), makeSession("sess-2")]);
    vi.mocked(api.post).mockResolvedValueOnce(makeSession("sess-2"));
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useSessions("ws-1"), { wrapper });
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));

    let created: SessionMetadata | null = null;
    await act(async () => {
      created = await result.current.createSession();
    });

    expect(created).toEqual(makeSession("sess-2"));
    expect(api.post).toHaveBeenCalledWith("/api/workspaces/ws-1/sessions", undefined);

    await waitFor(() => {
      expect(result.current.sessions).toEqual([makeSession("sess-1"), makeSession("sess-2")]);
    });
  });

  it("keeps sessions sorted after createSession refreshes with unsorted data", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce([makeSession("sess-middle", "ws-1", "2026-02-12T00:00:02.000Z")])
      .mockResolvedValueOnce([
        makeSession("sess-new", "ws-1", "2026-02-12T00:00:03.000Z"),
        makeSession("sess-old", "ws-1", "2026-02-12T00:00:01.000Z"),
        makeSession("sess-middle", "ws-1", "2026-02-12T00:00:02.000Z"),
      ]);
    vi.mocked(api.post).mockResolvedValueOnce(
      makeSession("sess-new", "ws-1", "2026-02-12T00:00:03.000Z"),
    );
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useSessions("ws-1"), { wrapper });
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));

    await act(async () => {
      await result.current.createSession();
    });

    await waitFor(() => {
      expect(result.current.sessions.map((s) => s.sessionId)).toEqual([
        "sess-old",
        "sess-middle",
        "sess-new",
      ]);
    });
  });

  it("deletes a session then refreshes the list", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce([makeSession("sess-1"), makeSession("sess-2")])
      .mockResolvedValueOnce([makeSession("sess-2")]);
    vi.mocked(api.delete).mockResolvedValueOnce(undefined);
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useSessions("ws-1"), { wrapper });
    await waitFor(() => expect(result.current.sessions).toHaveLength(2));

    let deleted = false;
    await act(async () => {
      deleted = await result.current.deleteSession("sess-1");
    });

    expect(deleted).toBe(true);
    expect(api.delete).toHaveBeenCalledWith("/api/workspaces/ws-1/sessions/sess-1");

    await waitFor(() => {
      expect(result.current.sessions).toEqual([makeSession("sess-2")]);
    });
  });

  it("returns safe values on create/delete errors", async () => {
    vi.mocked(api.get).mockResolvedValue([makeSession("sess-1")]);
    vi.mocked(api.post).mockRejectedValue(new Error("boom"));
    vi.mocked(api.delete).mockRejectedValue(new Error("boom"));
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useSessions("ws-1"), { wrapper });
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));

    await act(async () => {
      expect(await result.current.createSession()).toBeNull();
      expect(await result.current.deleteSession("sess-1")).toBe(false);
    });
  });

  it("exposes refresh to re-fetch sessions", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce([makeSession("sess-1")])
      .mockResolvedValueOnce([makeSession("sess-1"), makeSession("sess-3")]);
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useSessions("ws-1"), { wrapper });
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.sessions).toEqual([makeSession("sess-1"), makeSession("sess-3")]);
    });
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("creates a terminal session by sending the kind in the body", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce([makeSession("sess-1")])
      .mockResolvedValueOnce([makeSession("sess-1"), makeSession("term-1")]);
    vi.mocked(api.post).mockResolvedValueOnce({ ...makeSession("term-1"), kind: "terminal" });
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useSessions("ws-1"), { wrapper });
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));

    let created: SessionMetadata | null = null;
    await act(async () => {
      created = await result.current.createSession("terminal");
    });

    expect(created).toEqual({ ...makeSession("term-1"), kind: "terminal" });
    expect(api.post).toHaveBeenCalledWith("/api/workspaces/ws-1/sessions", { kind: "terminal" });
  });

  it("converts an empty chat session into a terminal in place", async () => {
    vi.mocked(api.get).mockResolvedValue([makeSession("sess-1")]);
    vi.mocked(api.post).mockResolvedValueOnce({ ...makeSession("sess-1"), kind: "terminal" });
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useSessions("ws-1"), { wrapper });
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));

    let converted: SessionMetadata | null = null;
    await act(async () => {
      converted = await result.current.convertToTerminal("sess-1");
    });

    expect(converted).toEqual({ ...makeSession("sess-1"), kind: "terminal" });
    expect(api.post).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/sessions/sess-1/convert-to-terminal",
    );
  });

  it("returns null when convert-to-terminal fails", async () => {
    vi.mocked(api.get).mockResolvedValue([makeSession("sess-1")]);
    vi.mocked(api.post).mockRejectedValueOnce(new Error("has messages"));
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useSessions("ws-1"), { wrapper });
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));

    await act(async () => {
      expect(await result.current.convertToTerminal("sess-1")).toBeNull();
    });
  });

  it("sorts sessions after manual refresh", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce([makeSession("sess-2", "ws-1", "2026-02-12T00:00:02.000Z")])
      .mockResolvedValueOnce([
        makeSession("sess-3", "ws-1", "2026-02-12T00:00:03.000Z"),
        makeSession("sess-1", "ws-1", "2026-02-12T00:00:01.000Z"),
        makeSession("sess-2", "ws-1", "2026-02-12T00:00:02.000Z"),
      ]);
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useSessions("ws-1"), { wrapper });
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.sessions.map((s) => s.sessionId)).toEqual([
        "sess-1",
        "sess-2",
        "sess-3",
      ]);
    });
  });
});
