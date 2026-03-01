import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNotificationToasts } from "@/hooks/useNotificationToasts";
import type { Project, WsOutgoing } from "@/types";

const mocks = vi.hoisted(() => ({
  onGlobalMessage: vi.fn(),
  offGlobalMessage: vi.fn(),
  globalHandler: null as ((workspaceId: string, msg: WsOutgoing) => void) | null,
  getLocalToastsEnabled: vi.fn(() => true),
  setSavedSession: vi.fn(),
  success: vi.fn(() => "toast-success"),
  error: vi.fn(() => "toast-error"),
  warning: vi.fn(() => "toast-warning"),
  dismiss: vi.fn(),
  navigate: vi.fn(),
  pathname: "/projects",
}));

vi.mock("@/lib/ws-transport", () => ({
  wsTransport: {
    onGlobalMessage: (handler: (workspaceId: string, msg: WsOutgoing) => void) => {
      mocks.onGlobalMessage(handler);
      mocks.globalHandler = handler;
      return mocks.offGlobalMessage;
    },
  },
}));

vi.mock("@/pages/settings/NotificationSettings", () => ({
  getLocalToastsEnabled: mocks.getLocalToastsEnabled,
}));

vi.mock("@/hooks/useConversation", () => ({
  setSavedSession: mocks.setSavedSession,
}));

vi.mock("sileo", () => ({
  sileo: {
    success: mocks.success,
    error: mocks.error,
    warning: mocks.warning,
    dismiss: mocks.dismiss,
  },
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useLocation: () => ({ pathname: mocks.pathname, search: "", hash: "", state: null, key: "test" }),
    useNavigate: () => mocks.navigate,
  };
});

function makeProjects(): Project[] {
  return [{
    id: "p1",
    name: "Alpha",
    url: "https://github.com/acme/alpha.git",
    createdAt: "2026-02-20T00:00:00.000Z",
    workspaces: [{
      id: "ws-1",
      name: "alpha-ws-1",
      branch: "workspace/feature/toasts",
      status: "idle",
      createdAt: "2026-02-20T00:00:00.000Z",
    }],
  }];
}

function emit(workspaceId: string, msg: WsOutgoing) {
  expect(mocks.globalHandler).not.toBeNull();
  act(() => {
    mocks.globalHandler?.(workspaceId, msg);
  });
}

describe("useNotificationToasts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.globalHandler = null;
    mocks.pathname = "/projects";
    mocks.getLocalToastsEnabled.mockReturnValue(true);
    mocks.success.mockReturnValue("toast-success");
    mocks.error.mockReturnValue("toast-error");
    mocks.warning.mockReturnValue("toast-warning");
  });

  it("subscribes on mount and unsubscribes on unmount", () => {
    const { unmount } = renderHook(() => useNotificationToasts(makeProjects()));

    expect(mocks.onGlobalMessage).toHaveBeenCalledTimes(1);
    unmount();
    expect(mocks.offGlobalMessage).toHaveBeenCalledTimes(1);
  });

  it("does not emit toasts when local toasts are disabled", () => {
    mocks.getLocalToastsEnabled.mockReturnValue(false);
    renderHook(() => useNotificationToasts(makeProjects()));

    emit("ws-1", { type: "done", sessionId: "sess-1" });

    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.warning).not.toHaveBeenCalled();
  });

  it("suppresses toasts for the workspace currently open", () => {
    mocks.pathname = "/workspaces/ws-1";
    renderHook(() => useNotificationToasts(makeProjects()));

    emit("ws-1", { type: "done", sessionId: "sess-1" });

    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("shows a success toast for done events and navigates to the targeted session", () => {
    renderHook(() => useNotificationToasts(makeProjects()));

    emit("ws-1", { type: "done", sessionId: "sess-1", durationMs: 5000 });

    const payload = mocks.success.mock.calls[0]?.[0];
    expect(payload).toEqual(expect.objectContaining({
      title: "Alpha · feature/toasts",
      description: "Turn complete in 5.0s",
      button: expect.objectContaining({ title: "View", onClick: expect.any(Function) }),
    }));

    act(() => {
      payload.button.onClick();
    });

    expect(mocks.dismiss).toHaveBeenCalledWith("toast-success");
    expect(mocks.setSavedSession).toHaveBeenCalledWith("ws-1", "sess-1");
    expect(mocks.navigate).toHaveBeenCalledWith("/workspaces/ws-1");
  });

  it("uses workspace id fallback label when project/workspace lookup misses", () => {
    renderHook(() => useNotificationToasts([]));

    emit("abcdef123456", { type: "done", sessionId: "sess-1" });

    expect(mocks.success).toHaveBeenCalledWith(expect.objectContaining({
      title: "abcdef12",
    }));
  });

  it("ignores user-initiated cancellations", () => {
    renderHook(() => useNotificationToasts(makeProjects()));

    emit("ws-1", { type: "cancelled", sessionId: "sess-1", userInitiated: true });

    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("shows error toast for agent-side cancellation failures", () => {
    renderHook(() => useNotificationToasts(makeProjects()));

    emit("ws-1", {
      type: "cancelled",
      sessionId: "sess-1",
      userInitiated: false,
      errorDetail: "Tool crashed",
    });

    expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({
      title: "Alpha · feature/toasts",
      description: "Tool crashed",
      button: expect.objectContaining({ title: "View", onClick: expect.any(Function) }),
    }));
  });

  it("shows warning toast for plan reviews with a Review CTA", () => {
    renderHook(() => useNotificationToasts(makeProjects()));

    emit("ws-1", {
      type: "tool_input_required",
      sessionId: "sess-9",
      requestId: "req-1",
      toolName: "ExitPlanMode",
      toolUseId: "tool-1",
      input: { questions: [] },
    });

    expect(mocks.warning).toHaveBeenCalledWith(expect.objectContaining({
      description: "Plan ready for review",
      button: expect.objectContaining({ title: "Review" }),
    }));
  });

  it("shows warning toast for generic input requests with a Respond CTA", () => {
    renderHook(() => useNotificationToasts(makeProjects()));

    emit("ws-1", {
      type: "tool_input_required",
      sessionId: "sess-9",
      requestId: "req-1",
      toolName: "AskUser",
      toolUseId: "tool-1",
      input: { question: "Continue?" },
    });

    expect(mocks.warning).toHaveBeenCalledWith(expect.objectContaining({
      description: "Agent needs input",
      button: expect.objectContaining({ title: "Respond" }),
    }));
  });

  it("navigates on error toasts without seeding session when session id is missing", () => {
    renderHook(() => useNotificationToasts(makeProjects()));

    emit("ws-1", { type: "error", message: "Backend unreachable" });

    const payload = mocks.error.mock.calls[0]?.[0];
    act(() => {
      payload.button.onClick();
    });

    expect(mocks.dismiss).toHaveBeenCalledWith("toast-error");
    expect(mocks.setSavedSession).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith("/workspaces/ws-1");
  });

  it("uses latest projects and latest pathname after rerenders", () => {
    const { rerender } = renderHook(
      ({ projects }) => useNotificationToasts(projects),
      { initialProps: { projects: [] as Project[] } },
    );

    rerender({ projects: makeProjects() });
    emit("ws-1", { type: "done", sessionId: "sess-1" });
    expect(mocks.success).toHaveBeenLastCalledWith(expect.objectContaining({
      title: "Alpha · feature/toasts",
    }));

    mocks.pathname = "/workspaces/ws-1";
    rerender({ projects: makeProjects() });
    emit("ws-1", { type: "done", sessionId: "sess-2" });
    expect(mocks.success).toHaveBeenCalledTimes(1);
  });
});
