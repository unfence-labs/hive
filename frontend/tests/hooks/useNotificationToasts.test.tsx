import { act, renderHook } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNotificationToasts } from "@/hooks/useNotificationToasts";
import type { HiveToastProps } from "@/components/ui/toaster";
import type { Project, WsOutgoing } from "@/types";

type CustomRender = (id: string | number) => ReactElement<HiveToastProps>;

const mocks = vi.hoisted(() => ({
  onGlobalMessage: vi.fn(),
  offGlobalMessage: vi.fn(),
  globalHandler: null as ((workspaceId: string, msg: WsOutgoing) => void) | null,
  getLocalToastsEnabled: vi.fn(() => true),
  setSavedSession: vi.fn(),
  custom: vi.fn(),
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

vi.mock("sonner", () => ({
  // HiveToaster is never rendered in these tests, only HiveToast is read.
  Toaster: () => null,
  toast: {
    custom: mocks.custom,
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

/** Read the props of the most recently emitted <HiveToast> custom toast. */
function lastToast(): { props: HiveToastProps; options: { id?: string | number; duration?: number }; id: string | number } {
  const calls = mocks.custom.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const [render, options] = calls[calls.length - 1] as [CustomRender, { id?: string | number; duration?: number }];
  const id = options?.id ?? "auto-id";
  return { props: render(id).props, options: options ?? {}, id };
}

describe("useNotificationToasts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.globalHandler = null;
    mocks.pathname = "/projects";
    mocks.getLocalToastsEnabled.mockReturnValue(true);
    // Mirror sonner: toast.custom returns the explicit id when provided.
    mocks.custom.mockImplementation((_render, options) => options?.id ?? "toast-custom");
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

    expect(mocks.custom).not.toHaveBeenCalled();
  });

  it("suppresses toasts for the workspace currently open", () => {
    mocks.pathname = "/workspaces/ws-1";
    renderHook(() => useNotificationToasts(makeProjects()));

    emit("ws-1", { type: "done", sessionId: "sess-1" });

    expect(mocks.custom).not.toHaveBeenCalled();
  });

  it("shows a success toast for done events and navigates to the targeted session", () => {
    renderHook(() => useNotificationToasts(makeProjects()));

    emit("ws-1", { type: "done", sessionId: "sess-1", durationMs: 5000 });

    const { props, options } = lastToast();
    expect(props).toMatchObject({
      variant: "success",
      title: "Alpha · feature/toasts",
      status: "Done",
      description: "Turn complete in 5.0s",
      actionLabel: "View",
    });
    expect(options.duration).toBe(5000);

    act(() => props.onAction?.());

    expect(mocks.setSavedSession).toHaveBeenCalledWith("ws-1", "sess-1");
    expect(mocks.navigate).toHaveBeenCalledWith("/workspaces/ws-1");
    expect(mocks.dismiss).toHaveBeenCalled();
  });

  it("uses workspace id fallback label when project/workspace lookup misses", () => {
    renderHook(() => useNotificationToasts([]));

    emit("abcdef123456", { type: "done", sessionId: "sess-1" });

    expect(lastToast().props.title).toBe("abcdef12");
  });

  it("ignores user-initiated cancellations", () => {
    renderHook(() => useNotificationToasts(makeProjects()));

    emit("ws-1", { type: "cancelled", sessionId: "sess-1", userInitiated: true });

    expect(mocks.custom).not.toHaveBeenCalled();
  });

  it("shows error toast for agent-side cancellation failures", () => {
    renderHook(() => useNotificationToasts(makeProjects()));

    emit("ws-1", {
      type: "cancelled",
      sessionId: "sess-1",
      userInitiated: false,
      errorDetail: "Tool crashed",
    });

    const { props, options } = lastToast();
    expect(props).toMatchObject({
      variant: "error",
      title: "Alpha · feature/toasts",
      status: "Failed",
      description: "Tool crashed",
      actionLabel: "View",
    });
    expect(options.duration).toBe(10000);
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

    const { props, options } = lastToast();
    expect(options.id).toBe("hive-action-toast:ws-1:sess-9");
    expect(options.duration).toBe(Infinity);
    expect(props).toMatchObject({
      variant: "warning",
      status: "Plan",
      description: "Plan ready for review",
      actionLabel: "Review",
    });
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

    const { props, options } = lastToast();
    expect(options.id).toBe("hive-action-toast:ws-1:sess-9");
    expect(options.duration).toBe(Infinity);
    expect(props).toMatchObject({
      variant: "warning",
      status: "Input",
      description: "Agent needs input",
      actionLabel: "Respond",
    });
  });

  it("dismisses sticky action toasts when the session completes", () => {
    renderHook(() => useNotificationToasts(makeProjects()));

    emit("ws-1", {
      type: "tool_input_required",
      sessionId: "sess-9",
      requestId: "req-1",
      toolName: "ExitPlanMode",
      toolUseId: "tool-1",
      input: { questions: [] },
    });
    emit("ws-1", { type: "done", sessionId: "sess-9" });

    expect(mocks.dismiss).toHaveBeenCalledWith("hive-action-toast:ws-1:sess-9");
    expect(lastToast().props).toMatchObject({
      variant: "success",
      description: "Turn complete",
    });
  });

  it("does not show a Done toast when the turn pauses on a blocking tool", () => {
    renderHook(() => useNotificationToasts(makeProjects()));

    emit("ws-1", {
      type: "tool_input_required",
      sessionId: "sess-9",
      requestId: "req-1",
      toolName: "AskUserQuestion",
      toolUseId: "tool-1",
      input: { questions: [] },
    });
    mocks.custom.mockClear();
    mocks.dismiss.mockClear();

    emit("ws-1", { type: "done", sessionId: "sess-9", pendingToolName: "AskUserQuestion" });

    expect(mocks.custom).not.toHaveBeenCalled();
    expect(mocks.dismiss).not.toHaveBeenCalled();
  });

  it("keeps sticky action toasts when the workspace is opened manually", () => {
    const { rerender } = renderHook(
      ({ projects }) => useNotificationToasts(projects),
      { initialProps: { projects: makeProjects() } },
    );

    emit("ws-1", {
      type: "tool_input_required",
      sessionId: "sess-9",
      requestId: "req-1",
      toolName: "AskUser",
      toolUseId: "tool-1",
      input: { question: "Continue?" },
    });

    mocks.pathname = "/workspaces/ws-1";
    rerender({ projects: makeProjects() });

    expect(mocks.dismiss).not.toHaveBeenCalled();
  });

  it("dismisses sticky action toasts when their CTA is clicked", () => {
    renderHook(() => useNotificationToasts(makeProjects()));

    emit("ws-1", {
      type: "tool_input_required",
      sessionId: "sess-9",
      requestId: "req-1",
      toolName: "AskUser",
      toolUseId: "tool-1",
      input: { question: "Continue?" },
    });

    const { props } = lastToast();
    act(() => props.onAction?.());

    expect(mocks.setSavedSession).toHaveBeenCalledWith("ws-1", "sess-9");
    expect(mocks.navigate).toHaveBeenCalledWith("/workspaces/ws-1");
    expect(mocks.dismiss).toHaveBeenCalledWith("hive-action-toast:ws-1:sess-9");
  });

  it("shows sticky action toasts even while viewing the workspace", () => {
    mocks.pathname = "/workspaces/ws-1";
    renderHook(() => useNotificationToasts(makeProjects()));

    emit("ws-1", {
      type: "tool_input_required",
      sessionId: "sess-9",
      requestId: "req-1",
      toolName: "AskUser",
      toolUseId: "tool-1",
      input: { question: "Continue?" },
    });

    expect(lastToast().options.id).toBe("hive-action-toast:ws-1:sess-9");
  });

  it("dismisses sticky action toasts when the session resumes streaming", () => {
    renderHook(() => useNotificationToasts(makeProjects()));

    emit("ws-1", {
      type: "tool_input_required",
      sessionId: "sess-9",
      requestId: "req-1",
      toolName: "AskUser",
      toolUseId: "tool-1",
      input: { question: "Continue?" },
    });

    emit("ws-1", { type: "status", status: "busy", sessionId: "sess-9", streaming: true });

    expect(mocks.dismiss).toHaveBeenCalledWith("hive-action-toast:ws-1:sess-9");
  });

  it("dismisses sticky action toasts on tool_input_resolved", () => {
    renderHook(() => useNotificationToasts(makeProjects()));

    emit("ws-1", {
      type: "tool_input_required",
      sessionId: "sess-9",
      requestId: "req-1",
      toolName: "AskUser",
      toolUseId: "tool-1",
      input: { question: "Continue?" },
    });

    emit("ws-1", { type: "tool_input_resolved", sessionId: "sess-9" });

    expect(mocks.dismiss).toHaveBeenCalledWith("hive-action-toast:ws-1:sess-9");
  });

  it("dismisses sticky action toasts on tool_input_resolved when local toasts are disabled", () => {
    renderHook(() => useNotificationToasts(makeProjects()));

    emit("ws-1", {
      type: "tool_input_required",
      sessionId: "sess-9",
      requestId: "req-1",
      toolName: "AskUser",
      toolUseId: "tool-1",
      input: { question: "Continue?" },
    });
    mocks.dismiss.mockClear();
    mocks.getLocalToastsEnabled.mockReturnValue(false);

    emit("ws-1", { type: "tool_input_resolved", sessionId: "sess-9" });

    expect(mocks.dismiss).toHaveBeenCalledWith("hive-action-toast:ws-1:sess-9");
  });

  it("dismisses sticky action toasts on terminal done when local toasts are disabled without creating completion toasts", () => {
    renderHook(() => useNotificationToasts(makeProjects()));

    emit("ws-1", {
      type: "tool_input_required",
      sessionId: "sess-9",
      requestId: "req-1",
      toolName: "AskUser",
      toolUseId: "tool-1",
      input: { question: "Continue?" },
    });
    mocks.custom.mockClear();
    mocks.dismiss.mockClear();
    mocks.getLocalToastsEnabled.mockReturnValue(false);

    emit("ws-1", { type: "done", sessionId: "sess-9" });

    expect(mocks.dismiss).toHaveBeenCalledWith("hive-action-toast:ws-1:sess-9");
    expect(mocks.custom).not.toHaveBeenCalled();
  });

  it("keeps sticky action toasts on non-streaming status events", () => {
    renderHook(() => useNotificationToasts(makeProjects()));

    emit("ws-1", {
      type: "tool_input_required",
      sessionId: "sess-9",
      requestId: "req-1",
      toolName: "AskUser",
      toolUseId: "tool-1",
      input: { question: "Continue?" },
    });

    emit("ws-1", { type: "status", status: "idle", sessionId: "sess-9", streaming: false });

    expect(mocks.dismiss).not.toHaveBeenCalled();
  });

  it("labels Brain toasts and navigates to /brain on action", () => {
    renderHook(() => useNotificationToasts(makeProjects()));

    emit("brain", { type: "done", sessionId: "sess-1" });

    const { props } = lastToast();
    expect(props.title).toBe("Brain");

    act(() => props.onAction?.());

    expect(mocks.setSavedSession).toHaveBeenCalledWith("brain", "sess-1");
    expect(mocks.navigate).toHaveBeenCalledWith("/brain");
  });

  it("suppresses Brain toasts while viewing /brain", () => {
    mocks.pathname = "/brain";
    renderHook(() => useNotificationToasts(makeProjects()));

    emit("brain", { type: "done", sessionId: "sess-1" });

    expect(mocks.custom).not.toHaveBeenCalled();
  });

  it("navigates on error toasts without seeding session when session id is missing", () => {
    renderHook(() => useNotificationToasts(makeProjects()));

    emit("ws-1", { type: "error", message: "Backend unreachable" });

    const { props } = lastToast();
    expect(props).toMatchObject({ variant: "error", status: "Error", description: "Backend unreachable" });

    act(() => props.onAction?.());

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
    expect(lastToast().props.title).toBe("Alpha · feature/toasts");

    mocks.pathname = "/workspaces/ws-1";
    rerender({ projects: makeProjects() });
    emit("ws-1", { type: "done", sessionId: "sess-2" });
    expect(mocks.custom).toHaveBeenCalledTimes(1);
  });
});
