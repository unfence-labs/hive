import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { AttachmentsContext } from "@/components/ai-elements/prompt-input";
import type { ThinkingLevel } from "@/types";

interface DraftState {
  value: string;
  thinkingEnabled: boolean;
  planMode: boolean;
  selectedModelId: string;
  thinkingLevel: ThinkingLevel;
  files: AttachmentsContext["files"];
}

interface UseChatInputDraftPersistenceParams {
  wsId?: string;
  sessionId?: string;
  value: string;
  thinkingEnabled: boolean;
  planMode: boolean;
  selectedModelId: string;
  defaultModelId: string;
  thinkingLevel: ThinkingLevel;
  attachmentsRef: MutableRefObject<AttachmentsContext | null>;
  setValue: (value: string) => void;
  setThinkingEnabled: (value: boolean) => void;
  setPlanMode: (value: boolean) => void;
  setSelectedModelId: (value: string) => void;
  setThinkingLevel: (value: ThinkingLevel) => void;
  setFileCount: (count: number) => void;
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
    draft.planMode ||
    !draft.thinkingEnabled
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
  thinkingEnabled,
  planMode,
  selectedModelId,
  defaultModelId,
  thinkingLevel,
  attachmentsRef,
  setValue,
  setThinkingEnabled,
  setPlanMode,
  setSelectedModelId,
  setThinkingLevel,
  setFileCount,
}: UseChatInputDraftPersistenceParams) {
  const prevSessionIdRef = useRef<string | undefined>(sessionId);
  const prevWsIdRef = useRef<string | undefined>(wsId);
  const valueRef = useRef(value);
  valueRef.current = value;
  const thinkingRef = useRef(thinkingEnabled);
  thinkingRef.current = thinkingEnabled;
  const planModeRef = useRef(planMode);
  planModeRef.current = planMode;
  const selectedModelIdRef = useRef(selectedModelId);
  selectedModelIdRef.current = selectedModelId;
  const thinkingLevelRef = useRef(thinkingLevel);
  thinkingLevelRef.current = thinkingLevel;
  const defaultModelIdRef = useRef(defaultModelId);
  defaultModelIdRef.current = defaultModelId;

  const saveDraftForSession = useCallback((
    targetSessionId: string | undefined,
    options?: { allowDelete?: boolean; targetWsId?: string },
  ) => {
    if (!targetSessionId) return;
    const files = attachmentsRef.current?.files ?? [];
    upsertDraft(options?.targetWsId ?? wsId, targetSessionId, {
      value: valueRef.current,
      thinkingEnabled: thinkingRef.current,
      planMode: planModeRef.current,
      selectedModelId: selectedModelIdRef.current,
      thinkingLevel: thinkingLevelRef.current,
      files: [...files],
    }, options?.allowDelete ?? true);
  }, [attachmentsRef, wsId]);

  useEffect(() => {
    const prevWsId = prevWsIdRef.current;
    if (prevWsId !== wsId) {
      saveDraftForSession(prevSessionIdRef.current, { targetWsId: prevWsId });
      prevSessionIdRef.current = sessionId;
      prevWsIdRef.current = wsId;
    }
  }, [wsId, sessionId, saveDraftForSession]);

  useEffect(() => {
    const prevId = prevSessionIdRef.current;
    if (prevId && prevId !== sessionId) {
      saveDraftForSession(prevId);
    }

    const draft = sessionId
      ? getWorkspaceDrafts(wsId).get(sessionId)
      : undefined;

    if (draft) {
      setValue(draft.value);
      setThinkingEnabled(draft.thinkingEnabled);
      setPlanMode(draft.planMode);
      setSelectedModelId(draft.selectedModelId);
      setThinkingLevel(draft.thinkingLevel);
      attachmentsRef.current?.restore([...draft.files]);
      setFileCount(draft.files.length);
    } else if (sessionId) {
      setValue("");
      setThinkingEnabled(true);
      setPlanMode(false);
      if (defaultModelIdRef.current) setSelectedModelId(defaultModelIdRef.current);
      attachmentsRef.current?.restore([]);
      setFileCount(0);
    }

    prevSessionIdRef.current = sessionId;
  }, [
    wsId,
    sessionId,
    saveDraftForSession,
    attachmentsRef,
    setValue,
    setThinkingEnabled,
    setPlanMode,
    setSelectedModelId,
    setThinkingLevel,
    setFileCount,
  ]);

  useEffect(() => {
    return () => {
      saveDraftForSession(prevSessionIdRef.current, { allowDelete: false });
    };
  }, [saveDraftForSession]);
}
