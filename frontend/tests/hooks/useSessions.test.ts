import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessions } from "@/hooks/useSessions";
import { api } from "@/hooks/useApi";
import type { SessionMetadata } from "@/types";

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

function makeSession(id: string, workspaceId = "ws-1"): SessionMetadata {
  return {
    sessionId: id,
    workspaceId,
    createdAt: "2026-02-12T00:00:00.000Z",
    updatedAt: "2026-02-12T00:00:01.000Z",
    messageCount: 0,
  };
}

describe("useSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches sessions on mount for a workspace", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([makeSession("sess-1")]);

    const { result } = renderHook(() => useSessions("ws-1"));

    await waitFor(() => {
      expect(result.current.sessions).toEqual([makeSession("sess-1")]);
    });
    expect(api.get).toHaveBeenCalledWith("/api/workspaces/ws-1/sessions");
    expect(result.current.loading).toBe(false);
  });

  it("stays empty and skips API calls when workspace is undefined", async () => {
    const { result } = renderHook(() => useSessions(undefined));

    await waitFor(() => {
      expect(result.current.sessions).toEqual([]);
    });
    expect(api.get).not.toHaveBeenCalled();

    await act(async () => {
      expect(await result.current.createSession()).toBeNull();
      expect(await result.current.activateSession("sess-1")).toBeNull();
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

    const { result } = renderHook(() => useSessions("ws-1"));

    await waitFor(() => {
      expect(result.current.sessions).toEqual([makeSession("sess-1")]);
    });

    let created: SessionMetadata | null = null;
    await act(async () => {
      created = await result.current.createSession();
    });

    expect(created).toEqual(makeSession("sess-2"));
    expect(api.post).toHaveBeenCalledWith("/api/workspaces/ws-1/sessions");
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(result.current.sessions).toEqual([makeSession("sess-1"), makeSession("sess-2")]);
  });

  it("activates a session then refreshes the list", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce([makeSession("sess-1")])
      .mockResolvedValueOnce([makeSession("sess-1"), makeSession("sess-2")]);
    vi.mocked(api.post).mockResolvedValueOnce(makeSession("sess-2"));

    const { result } = renderHook(() => useSessions("ws-1"));

    await waitFor(() => {
      expect(result.current.sessions).toEqual([makeSession("sess-1")]);
    });

    let activated: SessionMetadata | null = null;
    await act(async () => {
      activated = await result.current.activateSession("sess-2");
    });

    expect(activated).toEqual(makeSession("sess-2"));
    expect(api.post).toHaveBeenCalledWith("/api/workspaces/ws-1/sessions/sess-2/activate");
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(result.current.sessions).toEqual([makeSession("sess-1"), makeSession("sess-2")]);
  });

  it("deletes a session then refreshes the list", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce([makeSession("sess-1"), makeSession("sess-2")])
      .mockResolvedValueOnce([makeSession("sess-2")]);
    vi.mocked(api.delete).mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useSessions("ws-1"));

    await waitFor(() => {
      expect(result.current.sessions).toEqual([makeSession("sess-1"), makeSession("sess-2")]);
    });

    let deleted = false;
    await act(async () => {
      deleted = await result.current.deleteSession("sess-1");
    });

    expect(deleted).toBe(true);
    expect(api.delete).toHaveBeenCalledWith("/api/workspaces/ws-1/sessions/sess-1");
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(result.current.sessions).toEqual([makeSession("sess-2")]);
  });

  it("returns safe values on create/activate/delete errors", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([makeSession("sess-1")]);
    vi.mocked(api.post).mockRejectedValue(new Error("boom"));
    vi.mocked(api.delete).mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useSessions("ws-1"));
    await waitFor(() => {
      expect(result.current.sessions).toEqual([makeSession("sess-1")]);
    });

    await act(async () => {
      expect(await result.current.createSession()).toBeNull();
      expect(await result.current.activateSession("sess-1")).toBeNull();
      expect(await result.current.deleteSession("sess-1")).toBe(false);
    });

    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("exposes refresh to re-fetch sessions", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce([makeSession("sess-1")])
      .mockResolvedValueOnce([makeSession("sess-1"), makeSession("sess-3")]);

    const { result } = renderHook(() => useSessions("ws-1"));
    await waitFor(() => {
      expect(result.current.sessions).toEqual([makeSession("sess-1")]);
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(api.get).toHaveBeenCalledTimes(2);
    expect(result.current.sessions).toEqual([makeSession("sess-1"), makeSession("sess-3")]);
  });
});
