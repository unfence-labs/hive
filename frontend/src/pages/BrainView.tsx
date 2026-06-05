import { useCallback, useEffect, useRef, useState } from "react";
import { Group, Panel, useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { BrainIcon, MessageSquareIcon } from "lucide-react";
import { useBrain } from "@/hooks/useBrain";
import {
  useBrainFileContent,
  useBrainFileMutations,
  useBrainFileTree,
} from "@/hooks/useBrainFiles";
import { useBrainSave, useBrainStatus } from "@/hooks/useBrainGit";
import { ResizeHandle } from "@/components/ResizeHandle";
import { BrainEditorPanel, type BrainSaveIndicator } from "@/components/brain/BrainEditorPanel";
import { BrainFileTree } from "@/components/brain/BrainFileTree";
import { BrainReviewChanges } from "@/components/brain/BrainReviewChanges";

type CenterMode = "edit" | "review";

export default function BrainView() {
  const { brain, loading } = useBrain();
  const brainConnected = brain.exists;

  const fileTreeQuery = useBrainFileTree();
  const statusQuery = useBrainStatus();
  const { upsertFile, deleteFile, renameFile } = useBrainFileMutations();
  const { save, isSaving } = useBrainSave();

  const [selectedPath, setSelectedPath] = useState<string>("");
  const fileContentQuery = useBrainFileContent(selectedPath || null);

  const [centerMode, setCenterMode] = useState<CenterMode>("edit");
  const [saveIndicator, setSaveIndicator] = useState<BrainSaveIndicator>("idle");
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pendingCount = statusQuery.data?.count ?? 0;

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  // ── Resizable panels (id frozen now so M-C only fills the chat panel) ──
  const chatPanelRef = usePanelRef();
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "hive-brain",
    storage: localStorage,
  });

  const handleSelect = useCallback((path: string) => {
    setSelectedPath(path);
    setCenterMode("edit");
  }, []);

  const handleCreate = useCallback(
    async (path: string) => {
      await upsertFile(path, "");
      setSelectedPath(path);
      setCenterMode("edit");
    },
    [upsertFile],
  );

  const handleRename = useCallback(
    async (from: string, to: string) => {
      await renameFile({ from, to });
      setSelectedPath((current) => (current === from ? to : current));
    },
    [renameFile],
  );

  const handleDelete = useCallback(
    async (path: string) => {
      await deleteFile(path);
      setSelectedPath((current) => (current === path ? "" : current));
    },
    [deleteFile],
  );

  const handleWriteToDisk = useCallback(
    (path: string, content: string) => {
      void upsertFile(path, content);
    },
    [upsertFile],
  );

  const handleConfirmSave = useCallback(
    async (message: string) => {
      setSaveIndicator("saving");
      try {
        const result = await save(message || undefined);
        if (result.committed && !result.pushed) {
          setSaveIndicator("push-failed");
        } else {
          setSaveIndicator("saved");
          if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
          savedTimerRef.current = setTimeout(() => setSaveIndicator("idle"), 3000);
        }
        setCenterMode("edit");
      } catch {
        setSaveIndicator("push-failed");
        setCenterMode("edit");
      }
    },
    [save],
  );

  if (!loading && !brainConnected) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <BrainHeader />
        <div className="flex flex-1 items-center justify-center px-6">
          <p className="text-sm text-muted-foreground">No Brain repository connected.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <BrainHeader />
      <Group
        orientation="horizontal"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
        style={{ flex: 1, minHeight: 0, overflow: "hidden" }}
      >
        {/* Chat — collapsed by default, placeholder for M-C */}
        <Panel
          id="brain-chat"
          panelRef={chatPanelRef}
          collapsible
          collapsedSize={0}
          defaultSize={0}
          minSize="18%"
          maxSize="40%"
          className="bg-sidebar"
        >
          {/* Filled in M-C — wire the Brain agent chat here. */}
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
            <MessageSquareIcon className="size-5" />
            <span className="text-sm">Chat — coming in M-C</span>
          </div>
        </Panel>

        <ResizeHandle orientation="vertical" />

        {/* Editor / review (center, widest) */}
        <Panel id="brain-editor" minSize="40%" defaultSize="55%">
          {centerMode === "review" ? (
            <BrainReviewChanges
              onConfirm={handleConfirmSave}
              onCancel={() => setCenterMode("edit")}
              isSaving={isSaving}
            />
          ) : (
            <BrainEditorPanel
              filePath={selectedPath || null}
              loadedContent={fileContentQuery.data?.content ?? ""}
              isLoadingContent={!!selectedPath && fileContentQuery.isLoading}
              pendingCount={pendingCount}
              saveIndicator={saveIndicator}
              onWriteToDisk={handleWriteToDisk}
              onRequestReview={() => setCenterMode("review")}
            />
          )}
        </Panel>

        <ResizeHandle orientation="vertical" />

        {/* File tree (right) */}
        <Panel id="brain-tree" minSize={220} maxSize={480} defaultSize="25%" className="bg-sidebar">
          <BrainFileTree
            nodes={fileTreeQuery.data ?? []}
            selectedPath={selectedPath}
            error={fileTreeQuery.error?.message ?? null}
            onSelect={handleSelect}
            onCreate={handleCreate}
            onRename={handleRename}
            onDelete={handleDelete}
          />
        </Panel>
      </Group>
    </div>
  );
}

function BrainHeader() {
  return (
    <div className="border-b border-border px-6 py-4">
      <div className="flex items-center gap-2">
        <BrainIcon className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold text-foreground">Brain</h1>
      </div>
    </div>
  );
}
