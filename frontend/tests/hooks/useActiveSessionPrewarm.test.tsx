import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useActiveSessionPrewarm } from "@/hooks/useActiveSessionPrewarm";
import * as sessionMessages from "@/hooks/useSessionMessages";
import { BRAIN_WORKSPACE_ID } from "@/lib/brain";
import type { Project, SessionMetadata, Workspace } from "@/types";

const mocks = vi.hoisted(() => ({
  useBrain: vi.fn(),
  useSessions: vi.fn(),
}));

vi.mock("@/hooks/useBrain", () => ({ useBrain: mocks.useBrain }));
vi.mock("@/hooks/useSessions", () => ({ useSessions: mocks.useSessions }));

function wrapperFor(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function renderPrewarm(projects: Project[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return renderHook(() => useActiveSessionPrewarm(projects), {
    wrapper: wrapperFor(queryClient),
  });
}

function ws(overrides: Partial<Workspace> & { id: string }): Workspace {
  return {
    name: overrides.id,
    branch: "main",
    status: "idle",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function project(id: string, workspaces: Workspace[]): Project {
  return { id, name: id, createdAt: "2024-01-01T00:00:00Z", workspaces };
}

function brainSession(overrides: Partial<SessionMetadata> & { sessionId: string }): SessionMetadata {
  return {
    workspaceId: BRAIN_WORKSPACE_ID,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    messageCount: 1,
    ...overrides,
  } as SessionMetadata;
}

describe("useActiveSessionPrewarm", () => {
  let prefetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    prefetchSpy = vi.spyOn(sessionMessages, "prefetchSessionMessages").mockImplementation(() => {});
    // Default: no Brain configured, empty brain sessions.
    mocks.useBrain.mockReturnValue({ brain: { exists: false } });
    mocks.useSessions.mockReturnValue({ sessions: [] });
  });

  it("prewarms the active session of every workspace, skipping those without one", () => {
    renderPrewarm([
      project("p1", [
        ws({ id: "w1", activeSessionId: "s1", lastActivityAt: "2024-03-02T00:00:00Z" }),
        ws({ id: "w2", lastActivityAt: "2024-03-01T00:00:00Z" }), // no active session
      ]),
      project("p2", [
        ws({ id: "w3", activeSessionId: "s3", lastActivityAt: "2024-03-03T00:00:00Z" }),
      ]),
    ]);

    expect(prefetchSpy).toHaveBeenCalledTimes(2);
    expect(prefetchSpy).toHaveBeenCalledWith(expect.anything(), "w1", "s1");
    expect(prefetchSpy).toHaveBeenCalledWith(expect.anything(), "w3", "s3");
    const warmedWs = prefetchSpy.mock.calls.map((call) => call[1]);
    expect(warmedWs).not.toContain("w2");
  });

  it("orders most-recently-active first and caps the burst at 15 workspaces", () => {
    const workspaces = Array.from({ length: 20 }, (_, i) => {
      const day = String(i + 1).padStart(2, "0");
      return ws({
        id: `w${i}`,
        activeSessionId: `s${i}`,
        lastActivityAt: `2024-04-${day}T00:00:00Z`,
      });
    });

    renderPrewarm([project("p1", workspaces)]);

    const warmedWs = prefetchSpy.mock.calls.map((call) => call[1]);
    expect(warmedWs).toHaveLength(15);
    expect(warmedWs[0]).toBe("w19");
    expect(warmedWs[14]).toBe("w5");
    expect(warmedWs).not.toContain("w4");
  });

  it("does nothing when no workspace has an active session and no Brain exists", () => {
    renderPrewarm([project("p1", [ws({ id: "w1" }), ws({ id: "w2" })])]);
    expect(prefetchSpy).not.toHaveBeenCalled();
  });

  it("sinks workspaces without lastActivityAt below dated ones", () => {
    renderPrewarm([
      project("p1", [
        ws({ id: "wUndated", activeSessionId: "sU" }),
        ws({ id: "wDated", activeSessionId: "sD", lastActivityAt: "2024-05-01T00:00:00Z" }),
      ]),
    ]);

    const warmedWs = prefetchSpy.mock.calls.map((call) => call[1]);
    expect(warmedWs).toEqual(["wDated", "wUndated"]);
  });

  describe("Brain coverage", () => {
    it("prewarms the Brain's most-recent non-empty session when a Brain exists", () => {
      mocks.useBrain.mockReturnValue({ brain: { exists: true } });
      mocks.useSessions.mockReturnValue({
        sessions: [
          brainSession({ sessionId: "bOld", updatedAt: "2024-02-01T00:00:00Z", messageCount: 3 }),
          brainSession({ sessionId: "bNew", updatedAt: "2024-06-01T00:00:00Z", messageCount: 2 }),
          brainSession({ sessionId: "bEmpty", updatedAt: "2024-07-01T00:00:00Z", messageCount: 0 }),
        ],
      });

      renderPrewarm([project("p1", [ws({ id: "w1", activeSessionId: "s1" })])]);

      // Workspace active session + Brain entry (bNew, newest non-empty; bEmpty skipped).
      expect(prefetchSpy).toHaveBeenCalledWith(expect.anything(), "w1", "s1");
      expect(prefetchSpy).toHaveBeenCalledWith(expect.anything(), BRAIN_WORKSPACE_ID, "bNew");
      const warmed = prefetchSpy.mock.calls.map((call) => [call[1], call[2]]);
      expect(warmed).not.toContainEqual([BRAIN_WORKSPACE_ID, "bEmpty"]);
    });

    it("passes undefined to useSessions (disabling the query) when no Brain exists", () => {
      renderPrewarm([]);
      expect(mocks.useSessions).toHaveBeenCalledWith(undefined);
    });

    it("passes the Brain id to useSessions when a Brain exists", () => {
      mocks.useBrain.mockReturnValue({ brain: { exists: true } });
      mocks.useSessions.mockReturnValue({ sessions: [] });
      renderPrewarm([]);
      expect(mocks.useSessions).toHaveBeenCalledWith(BRAIN_WORKSPACE_ID);
    });

    it("does not prewarm the Brain when all its sessions are empty", () => {
      mocks.useBrain.mockReturnValue({ brain: { exists: true } });
      mocks.useSessions.mockReturnValue({
        sessions: [brainSession({ sessionId: "bEmpty", messageCount: 0 })],
      });
      renderPrewarm([]);
      expect(prefetchSpy).not.toHaveBeenCalled();
    });
  });
});
