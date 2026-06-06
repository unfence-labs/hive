import { useCallback, useEffect, useRef, type MutableRefObject, type Dispatch, type SetStateAction } from "react";
import type { AttachmentsContext } from "@/components/ai-elements/prompt-input";
import type { FileMention, ThinkingLevel } from "@/types";

interface DraftState {
  value: string;
  planMode: boolean;
  selectedModelId: string;
  thinkingLevel: ThinkingLevel;
  fastMode: boolean;
  files: AttachmentsContext["files"];
  fileMentions: FileMention[];
}

interface UseChatInputDraftPersistenceParams {
  wsId?: string;
  sessionId?: string;
  value: string;
  planMode: boolean;
  selectedModelId: string;
  defaultModelId: string;
  thinkingLevel: ThinkingLevel;
  fastMode: boolean;
  attachmentsRef: MutableRefObject<AttachmentsContext | null>;
  fileMentions: FileMention[];
  setValue: (value: string) => void;
  setPlanMode: (value: boolean) => void;
  setSelectedModelId: (value: string) => void;
  setThinkingLevel: (value: ThinkingLevel) => void;
  setFastMode: (value: boolean) => void;
  setFileCount: (count: number) => void;
  setFileMentions: Dispatch<SetStateAction<FileMention[]>>;
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
    draft.fileMentions.length > 0 ||
    draft.planMode ||
    draft.fastMode ||
    draft.thinkingLevel !== "high"
  );
}

function upsertDraft(
  wsId: string | undefined,
  sessionId: string,
  draft: DraftState,
  allowDelete = true,
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
  } else if (allowDelete) {
    drafts.delete(sessionId);
  }
}

export function useChatInputDraftPersistence({
  wsId,
  sessionId,
  value,
  planMode,
  selectedModelId,
  defaultModelId,
  thinkingLevel,
  fastMode,
  attachmentsRef,
  fileMentions,
  setValue,
  setPlanMode,
  setSelectedModelId,
  setThinkingLevel,
  setFastMode,
  setFileCount,
  setFileMentions,
}: UseChatInputDraftPersistenceParams) {
  const prevSessionIdRef = useRef<string | undefined>(undefined);
  const prevWsIdRef = useRef<string | undefined>(undefined);
  const valueRef = useRef(value);
  valueRef.current = value;
  const planModeRef = useRef(planMode);
  planModeRef.current = planMode;
  const selectedModelIdRef = useRef(selectedModelId);
  selectedModelIdRef.current = selectedModelId;
  const thinkingLevelRef = useRef(thinkingLevel);
  thinkingLevelRef.current = thinkingLevel;
  const fastModeRef = useRef(fastMode);
  fastModeRef.current = fastMode;
  const defaultModelIdRef = useRef(defaultModelId);
  defaultModelIdRef.current = defaultModelId;
  const fileMentionsRef = useRef(fileMentions);
  fileMentionsRef.current = fileMentions;
  const wsIdRef = useRef(wsId);
  wsIdRef.current = wsId;

  const saveDraftForSession = useCallback((
    targetSessionId: string | undefined,
    options?: { allowDelete?: boolean; targetWsId?: string },
  ) => {
    if (!targetSessionId) return;
    const files = attachmentsRef.current?.files ?? [];
    upsertDraft(options?.targetWsId ?? wsIdRef.current, targetSessionId, {
      value: valueRef.current,
      planMode: planModeRef.current,
      selectedModelId: selectedModelIdRef.current,
      thinkingLevel: thinkingLevelRef.current,
      fastMode: fastModeRef.current,
      files: [...files],
      fileMentions: [...fileMentionsRef.current],
    }, options?.allowDelete ?? true);
  }, [attachmentsRef]);

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
      const draft = getWorkspaceDrafts(wsId).get(sessionId);
      if (draft) {
        setValue(draft.value);
        setPlanMode(draft.planMode);
        setSelectedModelId(draft.selectedModelId);
        setThinkingLevel(draft.thinkingLevel);
        setFastMode(draft.fastMode ?? false);
        attachmentsRef.current?.restore([...draft.files]);
        setFileCount(draft.files.length);
        setFileMentions(draft.fileMentions ?? []);
      } else {
        setValue("");
        setPlanMode(false);
        setThinkingLevel("high");
        setFastMode(false);
        if (defaultModelIdRef.current) setSelectedModelId(defaultModelIdRef.current);
        attachmentsRef.current?.restore([]);
        setFileCount(0);
        setFileMentions([]);
      }
    }

    prevWsIdRef.current = wsId;
    prevSessionIdRef.current = sessionId;
  }, [
    wsId,
    sessionId,
    saveDraftForSession,
    attachmentsRef,
    setValue,
    setPlanMode,
    setSelectedModelId,
    setThinkingLevel,
    setFastMode,
    setFileCount,
    setFileMentions,
  ]);

  // Unmount cleanup: persist current draft without deleting.
  useEffect(() => {
    return () => {
      saveDraftForSession(prevSessionIdRef.current, {
        allowDelete: false,
        targetWsId: prevWsIdRef.current,
      });
    };
  }, [saveDraftForSession]);
}
