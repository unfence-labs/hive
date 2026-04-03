import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAllSessions } from "@/hooks/useAllSessions";
import { api } from "@/hooks/useApi";
import { createWrapper } from "../test-utils";
import type { SessionMetadata, Workspace } from "@/types";

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: vi.fn(),
  },
}));

function makeSession(
  sessionId: string,
  workspaceId: string,
  createdAt: string,
  title?: string,
): SessionMetadata {
  return {
    sessionId,
    workspaceId,
    createdAt,
    updatedAt: createdAt,
    messageCount: 0,
    title,
  };
}

function makeWorkspace(id: string): Workspace {
  return {
    id,
    name: `ws-${id}`,
    branch: "main",
    status: "idle",
    createdAt: "2026-01-01",
  };
}

describe("useAllSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty sessions when no workspaces", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAllSessions([]), { wrapper });
    expect(result.current.sessions).toEqual([]);
  });

  it("fetches sessions for each workspace", async () => {
    const ws1 = makeWorkspace("ws-1");
    const ws2 = makeWorkspace("ws-2");
    const s1 = makeSession("s1", "ws-1", "2026-01-01T00:00:00Z");
    const s2 = makeSession("s2", "ws-2", "2026-01-02T00:00:00Z");

    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes("ws-1")) return Promise.resolve([s1]);
      if (url.includes("ws-2")) return Promise.resolve([s2]);
      return Promise.resolve([]);
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAllSessions([ws1, ws2]), { wrapper });

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(2);
    });

    expect(result.current.sessions[0].tileId).toBe("ws-1:s1");
    expect(result.current.sessions[1].tileId).toBe("ws-2:s2");
  });

  it("sorts sessions by createdAt ascending within a workspace", async () => {
    const ws = makeWorkspace("ws-1");
    const newer = makeSession("newer", "ws-1", "2026-01-03T00:00:00Z");
    const older = makeSession("older", "ws-1", "2026-01-01T00:00:00Z");

    vi.mocked(api.get).mockResolvedValue([newer, older]);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAllSessions([ws]), { wrapper });

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(2);
    });

    expect(result.current.sessions[0].tileId).toBe("ws-1:older");
    expect(result.current.sessions[1].tileId).toBe("ws-1:newer");
  });

  it("deduplicates sessions by tileId", async () => {
    const ws = makeWorkspace("ws-1");
    const session = makeSession("s1", "ws-1", "2026-01-01T00:00:00Z");

    // Return the same session twice
    vi.mocked(api.get).mockResolvedValue([session, session]);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAllSessions([ws]), { wrapper });

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(1);
    });

    expect(result.current.sessions[0].tileId).toBe("ws-1:s1");
  });

  it("marks active session correctly", async () => {
    const ws: Workspace = {
      id: "ws-1",
      name: "denver",
      branch: "main",
      status: "idle",
      createdAt: "2026-01-01",
      activeSessionId: "s2",
    };
    const s1 = makeSession("s1", "ws-1", "2026-01-01T00:00:00Z");
    const s2 = makeSession("s2", "ws-1", "2026-01-02T00:00:00Z");

    vi.mocked(api.get).mockResolvedValue([s1, s2]);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAllSessions([ws]), { wrapper });

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(2);
    });

    expect(result.current.sessions[0].isActive).toBe(false);
    expect(result.current.sessions[1].isActive).toBe(true);
  });

  it("reports isLoading while fetching", () => {
    const ws = makeWorkspace("ws-1");
    vi.mocked(api.get).mockReturnValue(new Promise(() => {})); // never resolves

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAllSessions([ws]), { wrapper });

    expect(result.current.isLoading).toBe(true);
  });
});
