import { act, renderHook } from "@testing-library/react";
import { useRef, useState, type MutableRefObject, type RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileUIPart } from "ai";
import type { AttachmentsContext } from "@/components/ai-elements/prompt-input";
import type { FileMention, ThinkingLevel } from "@/types";
import { useChatInputDraftPersistence } from "@/hooks/useChatInputDraftPersistence";

type AttachmentFile = FileUIPart & { id: string };

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function makeAttachment(overrides: Partial<AttachmentFile> = {}): AttachmentFile {
  return {
    id: nextId("file-id"),
    type: "file",
    filename: `file-${nextId("name")}.png`,
    mediaType: "image/png",
    url: `blob:${nextId("blob")}`,
    ...overrides,
  };
}

function createAttachmentsContext(initialFiles: AttachmentFile[] = []): AttachmentsContext {
  const context: AttachmentsContext = {
    files: [...initialFiles],
    add: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(() => {
      context.files = [];
    }),
    restore: vi.fn((files: AttachmentFile[]) => {
      context.files = [...files];
    }),
    openFileDialog: vi.fn(),
    fileInputRef: { current: null } as RefObject<HTMLInputElement | null>,
  };
  return context;
}

function useDraftHarness({ wsId, sessionId }: { wsId?: string; sessionId?: string }) {
  const [value, setValue] = useState("");
  const [planMode, setPlanMode] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("high");
  const [fastMode, setFastMode] = useState(false);
  const [fileCount, setFileCount] = useState(0);
  const [fileMentions, setFileMentions] = useState<FileMention[]>([]);
  const attachmentsRef = useRef<AttachmentsContext | null>(null);

  if (!attachmentsRef.current) {
    attachmentsRef.current = createAttachmentsContext();
  }

  const setFiles = (files: AttachmentFile[]) => {
    if (attachmentsRef.current) {
      attachmentsRef.current.files = [...files];
    }
  };

  useChatInputDraftPersistence({
    wsId,
    sessionId,
    value,
    planMode,
    selectedModelId,
    defaultModelId: "claude:opus-4-7",
    thinkingLevel,
    fastMode,
    attachmentsRef: attachmentsRef as MutableRefObject<AttachmentsContext | null>,
    fileMentions,
    setValue,
    setPlanMode,
    setSelectedModelId,
    setThinkingLevel,
    setFastMode,
    setFileCount,
    setFileMentions,
  });

  return {
    value,
    planMode,
    selectedModelId,
    thinkingLevel,
    fastMode,
    fileCount,
    fileMentions,
    setValue,
    setPlanMode,
    setSelectedModelId,
    setThinkingLevel,
    setFastMode,
    setFileMentions,
    setFiles,
    attachments: attachmentsRef.current,
  };
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
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:${nextId("mock")}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useChatInputDraftPersistence", () => {
  it("restores text, toggles, and files when returning to a session", () => {
    const wsId = nextId("ws");
    const sessionA = nextId("sess-a");
    const sessionB = nextId("sess-b");
    const fileA = makeAttachment();

    const { result, rerender } = renderHook(
      ({ currentSessionId }: { currentSessionId?: string }) =>
        useDraftHarness({ wsId, sessionId: currentSessionId }),
      { initialProps: { currentSessionId: sessionA } },
    );

    act(() => {
      result.current.setValue("draft A");
      result.current.setThinkingLevel("low");
      result.current.setPlanMode(true);
      result.current.setFiles([fileA]);
    });

    rerender({ currentSessionId: sessionB });
    expect(result.current.value).toBe("");
    expect(result.current.thinkingLevel).toBe("high");
    expect(result.current.planMode).toBe(false);
    expect(result.current.fileCount).toBe(0);

    rerender({ currentSessionId: sessionA });
    expect(result.current.value).toBe("draft A");
    expect(result.current.thinkingLevel).toBe("low");
    expect(result.current.planMode).toBe(true);
    expect(result.current.fileCount).toBe(1);
    expect(result.current.attachments?.files).toEqual([fileA]);
  });

  it("keeps drafts isolated by workspace for the same session id", () => {
    const sessionId = nextId("sess-shared");
    const wsA = nextId("ws-a");
    const wsB = nextId("ws-b");

    const { result, rerender } = renderHook(
      ({ wsId }: { wsId: string }) => useDraftHarness({ wsId, sessionId }),
      { initialProps: { wsId: wsA } },
    );

    act(() => {
      result.current.setValue("workspace A draft");
    });

    rerender({ wsId: wsB });
    expect(result.current.value).toBe("");

    act(() => {
      result.current.setValue("workspace B draft");
    });

    rerender({ wsId: wsA });
    expect(result.current.value).toBe("workspace A draft");
  });

  it("persists toggle-only drafts when plan mode is enabled", () => {
    const wsId = nextId("ws");
    const sessionA = nextId("sess-a");
    const sessionB = nextId("sess-b");

    const { result, rerender } = renderHook(
      ({ currentSessionId }: { currentSessionId?: string }) =>
        useDraftHarness({ wsId, sessionId: currentSessionId }),
      { initialProps: { currentSessionId: sessionA } },
    );

    act(() => {
      result.current.setPlanMode(true);
    });

    rerender({ currentSessionId: sessionB });
    expect(result.current.planMode).toBe(false);

    rerender({ currentSessionId: sessionA });
    expect(result.current.planMode).toBe(true);
  });

  it("persists toggle-only drafts when thinking level differs from default", () => {
    const wsId = nextId("ws");
    const sessionA = nextId("sess-a");
    const sessionB = nextId("sess-b");

    const { result, rerender } = renderHook(
      ({ currentSessionId }: { currentSessionId?: string }) =>
        useDraftHarness({ wsId, sessionId: currentSessionId }),
      { initialProps: { currentSessionId: sessionA } },
    );

    act(() => {
      result.current.setThinkingLevel("low");
    });

    rerender({ currentSessionId: sessionB });
    expect(result.current.thinkingLevel).toBe("high");

    rerender({ currentSessionId: sessionA });
    expect(result.current.thinkingLevel).toBe("low");
  });

  it("persists and restores fast mode per session", () => {
    const wsId = nextId("ws");
    const sessionA = nextId("sess-a");
    const sessionB = nextId("sess-b");

    const { result, rerender } = renderHook(
      ({ currentSessionId }: { currentSessionId?: string }) =>
        useDraftHarness({ wsId, sessionId: currentSessionId }),
      { initialProps: { currentSessionId: sessionA } },
    );

    act(() => {
      result.current.setFastMode(true);
    });

    rerender({ currentSessionId: sessionB });
    expect(result.current.fastMode).toBe(false);

    rerender({ currentSessionId: sessionA });
    expect(result.current.fastMode).toBe(true);
  });

  it("deletes empty drafts after a switch when defaults are restored", () => {
    const wsId = nextId("ws");
    const sessionA = nextId("sess-a");
    const sessionB = nextId("sess-b");

    const { result, rerender } = renderHook(
      ({ currentSessionId }: { currentSessionId?: string }) =>
        useDraftHarness({ wsId, sessionId: currentSessionId }),
      { initialProps: { currentSessionId: sessionA } },
    );

    act(() => {
      result.current.setValue("temporary");
    });

    rerender({ currentSessionId: sessionB });
    rerender({ currentSessionId: sessionA });
    expect(result.current.value).toBe("temporary");

    act(() => {
      result.current.setValue("");
      result.current.setThinkingLevel("high");
      result.current.setPlanMode(false);
      result.current.setFiles([]);
    });

    rerender({ currentSessionId: sessionB });
    rerender({ currentSessionId: sessionA });
    expect(result.current.value).toBe("");
  });

  it("revokes blob URLs when saved attachments are removed from a draft", () => {
    const wsId = nextId("ws");
    const sessionA = nextId("sess-a");
    const sessionB = nextId("sess-b");
    const first = makeAttachment({ url: "blob:first" });
    const second = makeAttachment({ url: "blob:second" });

    const { result, rerender } = renderHook(
      ({ currentSessionId }: { currentSessionId?: string }) =>
        useDraftHarness({ wsId, sessionId: currentSessionId }),
      { initialProps: { currentSessionId: sessionA } },
    );

    act(() => {
      result.current.setValue("with attachments");
      result.current.setFiles([first, second]);
    });

    rerender({ currentSessionId: sessionB });
    rerender({ currentSessionId: sessionA });

    act(() => {
      result.current.setFiles([second]);
    });

    rerender({ currentSessionId: sessionB });

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:first");
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:second");
  });

  it("does not delete existing persisted draft on unmount", () => {
    const wsId = nextId("ws");
    const sessionA = nextId("sess-a");
    const sessionB = nextId("sess-b");

    const firstRender = renderHook(
      ({ currentSessionId }: { currentSessionId?: string }) =>
        useDraftHarness({ wsId, sessionId: currentSessionId }),
      { initialProps: { currentSessionId: sessionA } },
    );

    act(() => {
      firstRender.result.current.setValue("keep on unmount");
    });

    firstRender.rerender({ currentSessionId: sessionB });
    firstRender.rerender({ currentSessionId: sessionA });

    act(() => {
      firstRender.result.current.setValue("");
    });

    firstRender.unmount();

    const secondRender = renderHook(() =>
      useDraftHarness({ wsId, sessionId: sessionA }),
    );

    expect(secondRender.result.current.value).toBe("keep on unmount");
  });
});
