import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode, ReactElement } from "react";
import ChatInput from "@/components/ChatInput";
import { MODEL_CATALOG_QUERY_KEY } from "@/hooks/useModels";
import type { ChatMessage, ModelCatalogResponse } from "@/types";

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

const MODEL_CATALOG: ModelCatalogResponse = {
  models: [
    {
      id: "claude:sonnet-4-6",
      label: "Sonnet 4.6",
      provider: "claude",
      providerLabel: "Claude Code",
      isDefault: true,
      capabilities: {
        thinkingLevels: ["low", "medium", "high", "xhigh", "max"],
        planMode: true,
        blockingTools: true,
        completions: true,
        goals: false,
      },
    },
  ],
  defaultModelId: "claude:sonnet-4-6",
};

let queryClient: QueryClient;

function QueryWrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function renderWithQueryClient(element: ReactElement) {
  return render(element, { wrapper: QueryWrapper });
}

function chatInputProps({
  wsId = "ws-test",
  sessionId,
  draftPrompt,
  onSend = () => true,
}: {
  wsId?: string;
  sessionId?: string;
  draftPrompt?: string;
  onSend?: SendFn;
} = {}) {
  return {
    wsId,
    sessionId,
    draftPrompt,
    onSend,
    onStop: () => {},
    disabled: false,
    isStreaming: false,
    connectionStatus: "connected" as const,
    messages: [] as ChatMessage[],
  };
}

function renderChatInput(sessionId?: string, wsId?: string, onSend?: SendFn) {
  return renderWithQueryClient(
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
    draftPrompt,
    onSend,
  }: {
    sessionId?: string;
    wsId?: string;
    draftPrompt?: string;
    onSend?: SendFn;
  },
) {
  act(() => {
    rerender(<ChatInput {...chatInputProps({ sessionId, wsId, draftPrompt, onSend })} />);
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
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(MODEL_CATALOG_QUERY_KEY, MODEL_CATALOG);
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
  it("restores the selected output style when the conversation composer remounts", async () => {
    queryClient.setQueryData<ModelCatalogResponse>(MODEL_CATALOG_QUERY_KEY, {
      ...MODEL_CATALOG,
      models: MODEL_CATALOG.models.map((model) => ({
        ...model,
        capabilities: {
          ...model.capabilities,
          outputStyles: ["default", "proactive", "concise", "explanatory", "learning"],
        },
      })),
    });
    const user = userEvent.setup();
    const sessionId = nextId("style-session");
    const wsId = nextId("style-workspace");
    const { unmount } = renderChatInput(sessionId, wsId);

    await user.click(screen.getByRole("button", { name: "Output style: Default" }));
    await user.click(screen.getByRole("menuitem", { name: "Learning" }));
    unmount();
    renderChatInput(sessionId, wsId);

    expect(screen.getByRole("button", { name: "Output style: Learning" })).toBeInTheDocument();
  });

  it("seeds a server-owned session draft on mount", () => {
    const sessionId = nextId("draft-session");

    renderWithQueryClient(
      <ChatInput {...chatInputProps({ sessionId, draftPrompt: "Fix issue #42" })} />,
    );

    expect(inputValue()).toBe("Fix issue #42");
  });

  it("adopts the current composer when the first explicit session is created", () => {
    const sessionId = nextId("draft-session");
    const wsId = nextId("draft-workspace");
    const { rerender, unmount } = renderChatInput(undefined, wsId);

    setInputValue("Edited issue prompt");
    rerenderChatInput(rerender, { wsId, sessionId });
    expect(inputValue()).toBe("Edited issue prompt");

    unmount();
    renderChatInput(sessionId, wsId);
    expect(inputValue()).toBe("Edited issue prompt");
  });

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
    renderWithQueryClient(
      <ChatInput
        {...chatInputProps({ sessionId: nextId("sess"), onSend })}
        lastRunOptions={{ planMode: true, thinkingLevel: "xhigh", fastMode: false }}
      />,
    );

    await user.type(getInput(), "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenLastCalledWith("hello", undefined, {
      model: "claude:sonnet-4-6",
      planMode: true,
      thinkingLevel: "xhigh",
    }, undefined);
  });

  it("seeds defaults when the session has no lastRunOptions", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(() => true);
    renderWithQueryClient(
      <ChatInput {...chatInputProps({ sessionId: nextId("sess"), onSend })} />,
    );

    await user.type(getInput(), "hi");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenLastCalledWith("hi", undefined, {
      model: "claude:sonnet-4-6",
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

  it("does not restore a persisted draft after successful send and remount", async () => {
    const user = userEvent.setup();
    const { a: sessionA, b: sessionB } = makeSessionIds();
    const wsId = nextId("ws");
    const onSend = vi.fn(() => true);
    const { rerender, unmount } = renderChatInput(sessionA, wsId, onSend);

    setInputValue("send this draft");
    rerenderChatInput(rerender, { wsId, sessionId: sessionB, onSend });
    rerenderChatInput(rerender, { wsId, sessionId: sessionA, onSend });
    expect(inputValue()).toBe("send this draft");

    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("send this draft", undefined, {
      model: "claude:sonnet-4-6",
      planMode: false,
      thinkingLevel: "high",
    }, undefined);
    expect(inputValue()).toBe("");

    unmount();
    renderChatInput(sessionA, wsId, onSend);
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
