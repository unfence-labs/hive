import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatInput from "@/components/ChatInput";
import type { ChatMessage } from "@/types";

vi.mock("@/hooks/useCompletions", () => ({
  useCompletions: () => [],
}));

vi.mock("@/hooks/useFileCompletions", () => ({
  useFileCompletions: () => [],
}));

vi.mock("@/hooks/useApi", () => ({
  api: {
    get: vi.fn(
      () =>
        new Promise(() => {
          // Keep model fetch pending so ChatInput tests stay deterministic.
        }),
    ),
  },
}));

type SendFn = (
  content: string,
  images?: unknown[],
  options?: { planMode: boolean; thinkingLevel: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" },
) => boolean;

function chatInputProps({
  wsId = "ws-test",
  sessionId,
  onSend = () => true,
}: {
  wsId?: string;
  sessionId?: string;
  onSend?: SendFn;
} = {}) {
  return {
    wsId,
    sessionId,
    onSend,
    onStop: () => {},
    disabled: false,
    isStreaming: false,
    connectionStatus: "connected" as const,
    messages: [] as ChatMessage[],
  };
}

function renderChatInput(sessionId?: string, wsId?: string, onSend?: SendFn) {
  return render(
    <ChatInput
      {...chatInputProps({ sessionId, wsId, onSend })}
    />,
  );
}

function rerenderChatInput(
  rerender: ReturnType<typeof render>["rerender"],
  {
    sessionId,
    wsId,
    onSend,
  }: {
    sessionId?: string;
    wsId?: string;
    onSend?: SendFn;
  },
) {
  act(() => {
    rerender(<ChatInput {...chatInputProps({ sessionId, wsId, onSend })} />);
  });
}

function getInput(): HTMLTextAreaElement {
  return screen.getByPlaceholderText("Send message, #mention files, @call agents, run /commands") as HTMLTextAreaElement;
}

function inputValue(): string {
  return getInput().value;
}

function setInputValue(value: string): void {
  act(() => {
    fireEvent.change(getInput(), { target: { value } });
  });
}

function getUploadInput(): HTMLInputElement {
  return screen.getByLabelText("Upload files") as HTMLInputElement;
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

beforeEach(() => {
  if (!URL.createObjectURL) {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: () => "blob:fallback",
    });
  }
  if (!URL.revokeObjectURL) {
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: () => {},
    });
  }
  vi.spyOn(URL, "createObjectURL").mockImplementation((file: File | MediaSource) => {
    if (file instanceof File) return `blob:${file.name}-${nextId("file")}`;
    return `blob:media-${nextId("media")}`;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeSessionIds() {
  return {
    a: nextId("sess-a"),
    b: nextId("sess-b"),
  };
}

function makeWorkspaceIds() {
  return {
    a: nextId("ws-a"),
    b: nextId("ws-b"),
  };
}

describe("ChatInput draft persistence", () => {
  it("keeps per-session draft text when switching sessions", () => {
    const { a: sessionA, b: sessionB } = makeSessionIds();
    const { rerender } = renderChatInput(sessionA);

    setInputValue("draft A");
    rerenderChatInput(rerender, { sessionId: sessionB });
    expect(inputValue()).toBe("");

    setInputValue("draft B");
    rerenderChatInput(rerender, { sessionId: sessionA });
    expect(inputValue()).toBe("draft A");
  });

  it("does not erase existing draft on unmount/remount cycle", () => {
    const { a: sessionA, b: sessionB } = makeSessionIds();
    const { rerender, unmount } = renderChatInput(sessionA);

    setInputValue("keep me");

    rerenderChatInput(rerender, { sessionId: sessionB });
    unmount();

    renderChatInput(sessionA);
    expect(inputValue()).toBe("keep me");
  });

  it("keeps draft when switching workspace and coming back", () => {
    const { a: sessionA, b: sessionB } = makeSessionIds();
    const { a: wsA, b: wsB } = makeWorkspaceIds();
    const { rerender } = renderChatInput(sessionA, wsA);

    setInputValue("workspace A draft");

    rerenderChatInput(rerender, { wsId: wsB, sessionId: sessionB });
    expect(inputValue()).toBe("");

    rerenderChatInput(rerender, { wsId: wsA, sessionId: sessionA });
    expect(inputValue()).toBe("workspace A draft");
  });

  it("isolates drafts by workspace even with the same session id", () => {
    const sessionId = nextId("sess-shared");
    const { a: wsA, b: wsB } = makeWorkspaceIds();
    const { rerender } = renderChatInput(sessionId, wsA);

    setInputValue("draft from ws-a");
    rerenderChatInput(rerender, { wsId: wsB, sessionId });
    expect(inputValue()).toBe("");

    setInputValue("draft from ws-b");
    rerenderChatInput(rerender, { wsId: wsA, sessionId });
    expect(inputValue()).toBe("draft from ws-a");
  });

  // Run options (plan/thinking/fast/model) are no longer drafted; they are
  // seeded once at mount from the session's lastRunOptions. The parent remounts
  // ChatInput per session (key={wsId:sessionId}), so each session seeds cleanly.
  it("seeds plan mode and thinking level from lastRunOptions at mount", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(() => true);
    render(
      <ChatInput
        {...chatInputProps({ sessionId: nextId("sess"), onSend })}
        lastRunOptions={{ planMode: true, thinkingLevel: "xhigh", fastMode: false }}
      />,
    );

    await user.type(getInput(), "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenLastCalledWith("hello", undefined, {
      planMode: true,
      thinkingLevel: "xhigh",
    }, undefined);
  });

  it("seeds defaults when the session has no lastRunOptions", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(() => true);
    render(<ChatInput {...chatInputProps({ sessionId: nextId("sess"), onSend })} />);

    await user.type(getInput(), "hi");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenLastCalledWith("hi", undefined, {
      planMode: false,
      thinkingLevel: "high",
    }, undefined);
  });

  it("removes empty drafts after session switch", () => {
    const { a: sessionA, b: sessionB } = makeSessionIds();
    const { rerender } = renderChatInput(sessionA);

    setInputValue("temporary");
    rerenderChatInput(rerender, { sessionId: sessionB });
    rerenderChatInput(rerender, { sessionId: sessionA });
    expect(inputValue()).toBe("temporary");

    setInputValue("");
    rerenderChatInput(rerender, { sessionId: sessionB });
    rerenderChatInput(rerender, { sessionId: sessionA });
    expect(inputValue()).toBe("");
  });

  it("keeps draft when wsId changes before sessionId (multi-render-cycle)", () => {
    const sessA = nextId("sess-a");
    const sessB = nextId("sess-b");
    const { a: wsA, b: wsB } = makeWorkspaceIds();
    const { rerender } = renderChatInput(sessA, wsA);

    setInputValue("important draft");

    // Simulate real-world navigation: wsId changes first, sessionId is stale
    rerenderChatInput(rerender, { wsId: wsB, sessionId: sessA });
    // Then sessionId becomes undefined (prepare_workspace_switch)
    rerenderChatInput(rerender, { wsId: wsB, sessionId: undefined });
    // Then sessionId settles to the new workspace's session
    rerenderChatInput(rerender, { wsId: wsB, sessionId: sessB });
    expect(inputValue()).toBe("");

    // Navigate back — same multi-step transition
    rerenderChatInput(rerender, { wsId: wsA, sessionId: sessB });
    rerenderChatInput(rerender, { wsId: wsA, sessionId: undefined });
    rerenderChatInput(rerender, { wsId: wsA, sessionId: sessA });
    expect(inputValue()).toBe("important draft");
  });

  it("persists attachment previews per session across switches", async () => {
    const user = userEvent.setup();
    const { a: sessionA, b: sessionB } = makeSessionIds();
    const { rerender } = renderChatInput(sessionA);
    const file = new File(["img-a"], "avatar-a.png", { type: "image/png" });

    await user.upload(getUploadInput(), file);
    expect(screen.getByRole("img", { name: "avatar-a.png" })).toBeInTheDocument();

    rerenderChatInput(rerender, { sessionId: sessionB });
    expect(screen.queryByRole("img", { name: "avatar-a.png" })).not.toBeInTheDocument();

    rerenderChatInput(rerender, { sessionId: sessionA });
    expect(screen.getByRole("img", { name: "avatar-a.png" })).toBeInTheDocument();
  });
});
