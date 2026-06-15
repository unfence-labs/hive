import { useCallback, useEffect, useRef, type MutableRefObject, type Dispatch, type SetStateAction } from "react";
import type { AttachmentsContext } from "@/components/ai-elements/prompt-input";
import type { FileMention } from "@/types";

interface DraftState {
  value: string;
  files: AttachmentsContext["files"];
  fileMentions: FileMention[];
}

interface UseChatInputDraftPersistenceParams {
  wsId?: string;
  sessionId?: string;
  value: string;
  attachmentsRef: MutableRefObject<AttachmentsContext | null>;
  fileMentions: FileMention[];
  setValue: (value: string) => void;
  setFileCount: (count: number) => void;
  setFileMentions: Dispatch<SetStateAction<FileMention[]>>;
}

interface UseChatInputDraftPersistenceResult {
  discardCurrentDraft: () => void;
}

const DEFAULT_WORKSPACE_DRAFT_KEY = "__workspace_default__";
const draftStore = new Map<string, Map<string, DraftState>>();

function getWorkspaceDraftKey(wsId?: string): string {
  return wsId ?? DEFAULT_WORKSPACE_DRAFT_KEY;
}

function getWorkspaceDrafts(wsId?: string): Map<string, DraftState> {
  const workspaceKey = getWorkspaceDraftKey(wsId);
  let drafts = draftStore.get(workspaceKey);
  if (!drafts) {
    drafts = new Map<string, DraftState>();
    draftStore.set(workspaceKey, drafts);
  }
  return drafts;
}

function getStoredDraft(wsId: string | undefined, sessionId: string): DraftState | undefined {
  return draftStore.get(getWorkspaceDraftKey(wsId))?.get(sessionId);
}

function revokeRemovedFileUrls(
  prevFiles: AttachmentsContext["files"],
  nextFiles: AttachmentsContext["files"],
) {
  const nextUrls = new Set(
    nextFiles
      .map((file) => file.url)
      .filter((url): url is string => Boolean(url)),
  );
  for (const file of prevFiles) {
    if (file.url && !nextUrls.has(file.url)) {
      URL.revokeObjectURL(file.url);
    }
  }
}

function hasPersistableDraft(draft: DraftState): boolean {
  return (
    draft.value.trim().length > 0 ||
    draft.files.length > 0 ||
    draft.fileMentions.length > 0
  );
}

function upsertDraft(
  wsId: string | undefined,
  sessionId: string,
  draft: DraftState,
) {
  const drafts = getWorkspaceDrafts(wsId);
  const prevDraft = drafts.get(sessionId);
  const shouldPersist = hasPersistableDraft(draft);
  const nextFiles = shouldPersist ? draft.files : [];

  if (prevDraft) {
    revokeRemovedFileUrls(prevDraft.files, nextFiles);
  }

  if (shouldPersist) {
    drafts.set(sessionId, draft);
  } else {
    drafts.delete(sessionId);
  }
}

export function useChatInputDraftPersistence({
  wsId,
  sessionId,
  value,
  attachmentsRef,
  fileMentions,
  setValue,
  setFileCount,
  setFileMentions,
}: UseChatInputDraftPersistenceParams): UseChatInputDraftPersistenceResult {
  const prevSessionIdRef = useRef<string | undefined>(undefined);
  const prevWsIdRef = useRef<string | undefined>(undefined);
  const valueRef = useRef(value);
  valueRef.current = value;
  const fileMentionsRef = useRef(fileMentions);
  fileMentionsRef.current = fileMentions;
  const wsIdRef = useRef(wsId);
  wsIdRef.current = wsId;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const saveDraftForSession = useCallback((
    targetSessionId: string | undefined,
    options?: { targetWsId?: string },
  ) => {
    if (!targetSessionId) return;
    const files = attachmentsRef.current?.files ?? [];
    upsertDraft(options?.targetWsId ?? wsIdRef.current, targetSessionId, {
      value: valueRef.current,
      files: [...files],
      fileMentions: [...fileMentionsRef.current],
    });
  }, [attachmentsRef]);

  const restoreDraftState = useCallback((draft: DraftState | undefined) => {
    const nextValue = draft?.value ?? "";
    const nextFiles = draft ? [...draft.files] : [];
    const nextFileMentions = draft?.fileMentions ?? [];

    valueRef.current = nextValue;
    fileMentionsRef.current = nextFileMentions;

    setValue(nextValue);
    attachmentsRef.current?.restore(nextFiles);
    setFileCount(nextFiles.length);
    setFileMentions(nextFileMentions);
  }, [attachmentsRef, setValue, setFileCount, setFileMentions]);

  const discardCurrentDraft = useCallback(() => {
    const currentSessionId = sessionIdRef.current;

    valueRef.current = "";
    fileMentionsRef.current = [];
    attachmentsRef.current?.clear();

    setValue("");
    setFileCount(0);
    setFileMentions([]);

    if (!currentSessionId) return;

    upsertDraft(wsIdRef.current, currentSessionId, {
      value: "",
      files: [],
      fileMentions: [],
    });
  }, [attachmentsRef, setValue, setFileCount, setFileMentions]);

  // Merged save/restore effect — handles both workspace and session transitions
  // in a single pass, using the PREVIOUS wsId for saves to avoid the race where
  // wsId updates before sessionId in separate render cycles.
  useEffect(() => {
    const prevWsId = prevWsIdRef.current;
    const prevSessionId = prevSessionIdRef.current;
    const wsChanged = prevWsId !== wsId;
    const sessionChanged = prevSessionId !== sessionId;

    if (!wsChanged && !sessionChanged) return;

    // Save outgoing session's draft under its ORIGINAL workspace.
    if (prevSessionId) {
      saveDraftForSession(prevSessionId, { targetWsId: prevWsId });
    }

    // Restore incoming session's draft from the CURRENT workspace.
    // Skip when sessionId is undefined (transient workspace-switch state).
    if (sessionId && (wsChanged || sessionChanged)) {
      restoreDraftState(getStoredDraft(wsId, sessionId));
    }

    prevWsIdRef.current = wsId;
    prevSessionIdRef.current = sessionId;
  }, [
    wsId,
    sessionId,
    saveDraftForSession,
    restoreDraftState,
  ]);

  // Unmount cleanup: persist the current input exactly, including an empty
  // draft after the user clears or sends it.
  useEffect(() => {
    return () => {
      saveDraftForSession(prevSessionIdRef.current, {
        targetWsId: prevWsIdRef.current,
      });
    };
  }, [saveDraftForSession]);

  return { discardCurrentDraft };
}
