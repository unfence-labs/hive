import { act, renderHook } from "@testing-library/react";
import { useRef, useState, type MutableRefObject, type RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileUIPart } from "ai";
import type { AttachmentsContext } from "@/components/ai-elements/prompt-input";
import type { FileMention } from "@/types";
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

// The draft hook only owns text, files, and file mentions. Run options
// (model, plan mode, thinking level, fast mode) are seeded from the session's
// lastRunOptions in ChatInput, not persisted as drafts.
function useDraftHarness({ wsId, sessionId }: { wsId?: string; sessionId?: string }) {
  const [value, setValue] = useState("");
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
    attachmentsRef: attachmentsRef as MutableRefObject<AttachmentsContext | null>,
    fileMentions,
    setValue,
    setFileCount,
    setFileMentions,
  });

  return {
    value,
    fileCount,
    fileMentions,
    setValue,
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
  it("restores text and files when returning to a session", () => {
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
      result.current.setFiles([fileA]);
    });

    rerender({ currentSessionId: sessionB });
    expect(result.current.value).toBe("");
    expect(result.current.fileCount).toBe(0);

    rerender({ currentSessionId: sessionA });
    expect(result.current.value).toBe("draft A");
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

  it("does not persist a toggle-only intent (no text/files/mentions)", () => {
    // Run options are no longer drafted, so an empty input never persists,
    // regardless of any control toggles the user flipped without typing.
    const wsId = nextId("ws");
    const sessionA = nextId("sess-a");
    const sessionB = nextId("sess-b");

    const { result, rerender } = renderHook(
      ({ currentSessionId }: { currentSessionId?: string }) =>
        useDraftHarness({ wsId, sessionId: currentSessionId }),
      { initialProps: { currentSessionId: sessionA } },
    );

    // No text typed.
    rerender({ currentSessionId: sessionB });
    rerender({ currentSessionId: sessionA });
    expect(result.current.value).toBe("");
    expect(result.current.fileCount).toBe(0);
  });

  it("deletes empty drafts after a switch", () => {
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
