import { useState, useMemo } from "react";
import { Loader2, Plus, Trash2, Save, X, RotateCcw, ChevronRight, HelpCircle, Sparkles, Brain } from "lucide-react";
import type { UseQueryResult, UseMutationResult } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingsHeader } from "@/components/AppLayout";
import {
  usePromptTemplates,
  useCreatePromptTemplate,
  useUpdatePromptTemplate,
  useDeletePromptTemplate,
} from "@/hooks/usePromptTemplates";
import {
  useBasePrompt,
  useUpdateBasePrompt,
  useResetBasePrompt,
} from "@/hooks/useBasePrompt";
import {
  useBrainPrompt,
  useUpdateBrainPrompt,
  useResetBrainPrompt,
} from "@/hooks/useBrainPrompt";
import { PromptEditor } from "@/components/PromptEditor";
import { PromptFlowExplainer } from "@/components/PromptFlowExplainer";
import { cn } from "@/lib/utils";
import type { BasePromptData, PromptTemplate } from "@/types";

// ── Types ──────────────────────────────────────────────────────────────

type Selection =
  | { kind: "base" }
  | { kind: "brain" }
  | { kind: "template"; id: string }
  | { kind: "create"; type: "system" | "user" }
  | null;

// ── Constants ──────────────────────────────────────────────────────────

const TEMPLATE_VARIABLES = [
  { token: "{DIR}", desc: "workspace path" },
  { token: "{DEFAULT_BRANCH}", desc: "target branch" },
  { token: "{PROJECT}", desc: "project name" },
] as const;

// ── Main page ──────────────────────────────────────────────────────────

export default function PromptTemplatesSettings() {
  const { data: templates, isLoading: templatesLoading } = usePromptTemplates();
  const { data: baseData, isLoading: baseLoading } = useBasePrompt();
  const { data: brainData, isLoading: brainLoading } = useBrainPrompt();
  const [selection, setSelection] = useState<Selection>({ kind: "base" });
  const [deleteTarget, setDeleteTarget] = useState<PromptTemplate | null>(null);
  const [showFlowDialog, setShowFlowDialog] = useState(false);

  const systemTemplates = useMemo(
    () => templates?.filter((t) => t.type === "system") ?? [],
    [templates],
  );
  const userTemplates = useMemo(
    () => templates?.filter((t) => t.type === "user") ?? [],
    [templates],
  );

  // Resolve the selected template object
  const selectedTemplate = useMemo(() => {
    if (selection?.kind !== "template") return null;
    return templates?.find((t) => t.id === selection.id) ?? null;
  }, [selection, templates]);

  // If selected template was deleted externally, fall back to base
  if (selection?.kind === "template" && templates && !selectedTemplate) {
    setSelection({ kind: "base" });
  }

  if (templatesLoading || baseLoading || brainLoading) return null;

  const handleDelete = (template: PromptTemplate) => {
    setDeleteTarget(template);
  };

  const handleDeleteDone = () => {
    if (deleteTarget && selection?.kind === "template" && selection.id === deleteTarget.id) {
      setSelection({ kind: "base" });
    }
    setDeleteTarget(null);
  };

  const handleCreated = (id: string) => {
    setSelection({ kind: "template", id });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <SettingsHeader>
        <h1 className="text-sm font-medium">Prompts</h1>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setShowFlowDialog(true)}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        >
          <HelpCircle className="h-3 w-3" />
          How it works
        </button>
      </SettingsHeader>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left Panel ─────────────────────────────────────────── */}
        <LeftPanel
          selection={selection}
          onSelect={setSelection}
          baseData={baseData ?? null}
          brainData={brainData ?? null}
          systemTemplates={systemTemplates}
          userTemplates={userTemplates}
        />

        {/* ── Right Panel ────────────────────────────────────────── */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <RightPanel
            selection={selection}
            selectedTemplate={selectedTemplate}
            onDelete={handleDelete}
            onCreated={handleCreated}
            onCancel={() => setSelection({ kind: "base" })}
          />
        </div>
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && handleDeleteDone()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template</AlertDialogTitle>
            <AlertDialogDescription>
              Delete &ldquo;{deleteTarget?.name}&rdquo;? This cannot be undone. Templates referenced
              by automations cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <DeleteButton template={deleteTarget} onDone={handleDeleteDone} />
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* How it works dialog */}
      <Dialog open={showFlowDialog} onOpenChange={setShowFlowDialog}>
        <DialogContent className="max-h-[80vh] overflow-auto sm:max-w-4xl">
          {/* Title/description live in PromptFlowExplainer; keep them here sr-only for dialog a11y. */}
          <DialogTitle className="sr-only">Prompt Construction Flow</DialogTitle>
          <DialogDescription className="sr-only">
            How your prompts are assembled before being sent to the AI model.
          </DialogDescription>
          <PromptFlowExplainer />
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Left Panel ─────────────────────────────────────────────────────────

interface BasePromptSummary {
  isDefault: boolean;
}

function LeftPanel({
  selection,
  onSelect,
  baseData,
  brainData,
  systemTemplates,
  userTemplates,
}: {
  selection: Selection;
  onSelect: (s: Selection) => void;
  baseData: BasePromptSummary | null;
  brainData: BasePromptSummary | null;
  systemTemplates: PromptTemplate[];
  userTemplates: PromptTemplate[];
}) {
  return (
    <div className="flex w-64 shrink-0 flex-col border-r border-border/50">
      <ScrollArea className="flex-1">
        <div className="p-2">
          {/* Pinned: Build Agent Prompt */}
          <ListItem
            label="Build Agent Prompt"
            icon={<Sparkles className="h-3 w-3 text-primary" />}
            badge={baseData?.isDefault ? "Default" : "Custom"}
            badgeVariant={baseData?.isDefault ? "secondary" : "default"}
            isSelected={selection?.kind === "base"}
            onClick={() => onSelect({ kind: "base" })}
          />

          {/* Pinned: Brain Agent Prompt */}
          <ListItem
            label="Brain Agent Prompt"
            icon={<Brain className="h-3 w-3 text-primary" />}
            badge={brainData?.isDefault ? "Default" : "Custom"}
            badgeVariant={brainData?.isDefault ? "secondary" : "default"}
            isSelected={selection?.kind === "brain"}
            onClick={() => onSelect({ kind: "brain" })}
          />

          <div className="my-2 border-t border-border/30" />

          {/* System templates */}
          {systemTemplates.length > 0 && (
            <div className="mb-1">
              <h3 className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                System
              </h3>
              {systemTemplates.map((tpl) => (
                <ListItem
                  key={tpl.id}
                  label={tpl.name}
                  isSelected={selection?.kind === "template" && selection.id === tpl.id}
                  onClick={() => onSelect({ kind: "template", id: tpl.id })}
                />
              ))}
            </div>
          )}

          {/* User templates */}
          {userTemplates.length > 0 && (
            <div className="mb-1">
              <h3 className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                User
              </h3>
              {userTemplates.map((tpl) => (
                <ListItem
                  key={tpl.id}
                  label={tpl.name}
                  isSelected={selection?.kind === "template" && selection.id === tpl.id}
                  onClick={() => onSelect({ kind: "template", id: tpl.id })}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Add Template button */}
      <div className="border-t border-border/30 p-2">
        <button
          type="button"
          onClick={() => onSelect({ kind: "create", type: "system" })}
          className={cn(
            "inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-primary/40 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:border-primary hover:bg-primary/10",
            selection?.kind === "create" && "border-primary bg-primary/10",
          )}
        >
          <Plus className="h-3 w-3" />
          Add Template
        </button>
      </div>
    </div>
  );
}

// ── List Item ──────────────────────────────────────────────────────────

function ListItem({
  label,
  icon,
  badge,
  badgeVariant = "secondary",
  isSelected,
  onClick,
}: {
  label: string;
  icon?: React.ReactNode;
  badge?: string;
  badgeVariant?: "default" | "secondary";
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        isSelected
          ? "bg-primary/15 text-foreground"
          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge && (
        <Badge
          variant={badgeVariant}
          className="shrink-0 px-1.5 py-0 text-[10px]"
        >
          {badge}
        </Badge>
      )}
    </button>
  );
}

// ── Right Panel ────────────────────────────────────────────────────────

function RightPanel({
  selection,
  selectedTemplate,
  onDelete,
  onCreated,
  onCancel,
}: {
  selection: Selection;
  selectedTemplate: PromptTemplate | null;
  onDelete: (t: PromptTemplate) => void;
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  if (selection?.kind === "base") {
    return <BasePromptDetail />;
  }

  if (selection?.kind === "brain") {
    return <BrainPromptDetail />;
  }

  if (selection?.kind === "template" && selectedTemplate) {
    return (
      <TemplateDetail
        key={selectedTemplate.id}
        template={selectedTemplate}
        onDelete={() => onDelete(selectedTemplate)}
      />
    );
  }

  if (selection?.kind === "create") {
    return (
      <CreateTemplateForm
        initialType={selection.type}
        onCreated={onCreated}
        onCancel={onCancel}
      />
    );
  }

  return <EmptyState />;
}

// ── Editable Prompt Detail (shared) ────────────────────────────────────

type PromptVariable = { token: string; desc: string };

/**
 * Shared master-detail editor for an editable prompt resource (Build Agent
 * Prompt, Brain Agent Prompt). Owns the header/badge/description, the
 * `PromptEditor`, an optional template-variables hint, the collapsible
 * "View default prompt" section, the Save/Reset actions, and the reset-confirm
 * dialog. Base and brain plug in by passing their own resource hooks + copy.
 */
function EditablePromptDetail({
  title,
  description,
  variables,
  resetDescription,
  usePrompt,
  useUpdatePrompt,
  useResetPrompt,
}: {
  title: string;
  description: string;
  /** Optional `{TEMPLATE_VAR}` hint shown under the editor. */
  variables?: readonly PromptVariable[];
  /** Copy for the reset confirmation dialog body. */
  resetDescription: string;
  usePrompt: () => UseQueryResult<BasePromptData>;
  useUpdatePrompt: () => UseMutationResult<BasePromptData, Error, string>;
  useResetPrompt: () => UseMutationResult<unknown, Error, void>;
}) {
  const { data } = usePrompt();
  const updateMutation = useUpdatePrompt();
  const resetMutation = useResetPrompt();
  const [draft, setDraft] = useState(data?.content ?? "");
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showDefault, setShowDefault] = useState(false);

  if (!data) return null;

  const isDirty = draft !== data.content;

  const handleSave = async () => {
    if (!draft.trim()) return;
    await updateMutation.mutateAsync(draft);
  };

  const handleReset = async () => {
    await resetMutation.mutateAsync();
    setShowResetConfirm(false);
    setShowDefault(false);
    setDraft(data.defaultContent);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden px-5 pt-5 pb-2" key={data.isDefault ? "default" : "custom"}>
      {/* Header */}
      <div className="mb-4 shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-medium text-foreground">{title}</h2>
          <Badge
            variant="secondary"
            className={cn(
              "text-[10px]",
              !data.isDefault && "bg-primary/10 text-primary",
            )}
          >
            {data.isDefault ? "Default" : "Custom"}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>

      {/* Editor */}
      <div className="min-h-0 flex-1">
        <PromptEditor value={draft} onChange={setDraft} maxHeight="100%" />
      </div>

      {/* Template variables hint */}
      {variables && variables.length > 0 && (
        <div className="mt-3 flex shrink-0 flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground/70">
          <span className="font-medium text-muted-foreground">Variables:</span>
          {variables.map((v) => (
            <span key={v.token}>
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">{v.token}</code>{" "}
              <span className="text-muted-foreground/50">{v.desc}</span>
            </span>
          ))}
        </div>
      )}

      {/* Collapsible default view */}
      {!data.isDefault && (
        <div className="mt-3 shrink-0">
          <Collapsible open={showDefault} onOpenChange={setShowDefault}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronRight
                  className={cn("h-3 w-3 transition-transform", showDefault && "rotate-90")}
                />
                View default prompt
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2">
                <PromptEditor value={data.defaultContent} readOnly maxHeight="12rem" />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!isDirty || !draft.trim() || updateMutation.isPending}
          className={cn(
            "inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90",
            (!isDirty || !draft.trim() || updateMutation.isPending) && "pointer-events-none opacity-60",
          )}
        >
          {updateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save
        </button>
        {!data.isDefault && (
          <button
            type="button"
            onClick={() => setShowResetConfirm(true)}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-red-400"
          >
            <RotateCcw className="h-3 w-3" />
            Reset to default
          </button>
        )}
      </div>

      {/* Reset confirmation */}
      <AlertDialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to default</AlertDialogTitle>
            <AlertDialogDescription>{resetDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleReset()}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {resetMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Reset"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Build Agent Prompt editor — interpolates workspace git/project variables. */
function BasePromptDetail() {
  return (
    <EditablePromptDetail
      title="Build Agent Prompt"
      description="Injected into every build agent session under workspaces."
      variables={TEMPLATE_VARIABLES}
      resetDescription="Your custom base prompt will be removed and replaced with the default system prompt. This cannot be undone."
      usePrompt={useBasePrompt}
      useUpdatePrompt={useUpdateBasePrompt}
      useResetPrompt={useResetBasePrompt}
    />
  );
}

/**
 * Brain Agent Prompt editor — no git/project variables; the Brain's file-path
 * map is appended automatically by the backend.
 */
function BrainPromptDetail() {
  return (
    <EditablePromptDetail
      title="Brain Agent Prompt"
      description="Injected into every Brain agent session. The Brain's file map is appended automatically."
      resetDescription="Your custom Brain prompt will be removed and replaced with the default system prompt. This cannot be undone."
      usePrompt={useBrainPrompt}
      useUpdatePrompt={useUpdateBrainPrompt}
      useResetPrompt={useResetBrainPrompt}
    />
  );
}

// ── Template Detail ────────────────────────────────────────────────────

function TemplateDetail({
  template,
  onDelete,
}: {
  template: PromptTemplate;
  onDelete: () => void;
}) {
  const updateMutation = useUpdatePromptTemplate();
  const [draftName, setDraftName] = useState(template.name);
  const [draftContent, setDraftContent] = useState(template.content);

  const isDirty = draftName !== template.name || draftContent !== template.content;
  const isValid = draftName.trim() && draftContent.trim();

  const handleSave = async () => {
    if (!isValid) return;
    await updateMutation.mutateAsync({
      id: template.id,
      name: draftName.trim(),
      content: draftContent.trim(),
    });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden px-5 pt-5 pb-2">
      {/* Header */}
      <div className="mb-4 shrink-0">
        <div className="flex items-center gap-3">
          <Input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            className="text-sm font-medium"
            placeholder="Template name"
          />
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            {template.type}
          </Badge>
        </div>
      </div>

      {/* Editor */}
      <div className="min-h-0 flex-1">
        <PromptEditor
          value={draftContent}
          onChange={setDraftContent}
          maxHeight="100%"
          placeholder={template.type === "system" ? "You are a code auditor..." : "Review the codebase and..."}
        />
      </div>

      {/* Actions */}
      <div className="mt-4 flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!isDirty || !isValid || updateMutation.isPending}
          className={cn(
            "inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90",
            (!isDirty || !isValid || updateMutation.isPending) && "pointer-events-none opacity-60",
          )}
        >
          {updateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-red-400"
        >
          <Trash2 className="h-3 w-3" />
          Delete
        </button>
      </div>
    </div>
  );
}

// ── Create Template Form ───────────────────────────────────────────────

function CreateTemplateForm({
  initialType,
  onCreated,
  onCancel,
}: {
  initialType: "system" | "user";
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const createMutation = useCreatePromptTemplate();
  const [name, setName] = useState("");
  const [type, setType] = useState<"system" | "user">(initialType);
  const [content, setContent] = useState("");

  const isValid = name.trim() && content.trim();

  const handleSubmit = async () => {
    if (!isValid) return;
    const result = await createMutation.mutateAsync({
      name: name.trim(),
      type,
      content: content.trim(),
    });
    onCreated(result.id);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden px-5 pt-5 pb-2">
      {/* Header */}
      <div className="mb-4 shrink-0">
        <h2 className="text-base font-medium text-foreground">New Template</h2>
      </div>

      {/* Name */}
      <div className="mb-3 shrink-0">
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Name</label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Code Audit System Prompt"
          className="text-sm"
        />
      </div>

      {/* Type */}
      <div className="mb-3 shrink-0">
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Type</label>
        <div className="flex gap-2">
          {(["system", "user"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={cn(
                "cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors",
                type === t
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "system" ? "System" : "User"}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="mb-1.5 shrink-0">
        <label className="block text-xs font-medium text-muted-foreground">Content</label>
      </div>
      <div className="min-h-0 flex-1">
        <PromptEditor
          value={content}
          onChange={setContent}
          maxHeight="100%"
          placeholder={type === "system" ? "You are a code auditor..." : "Review the codebase and..."}
        />
      </div>

      {/* Actions */}
      <div className="mt-4 flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!isValid || createMutation.isPending}
          className={cn(
            "inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90",
            (!isValid || createMutation.isPending) && "pointer-events-none opacity-60",
          )}
        >
          {createMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Create
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-3 w-3" />
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Empty State ────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Select a prompt to edit
    </div>
  );
}

// ── Delete Button ──────────────────────────────────────────────────────

function DeleteButton({ template, onDone }: { template: PromptTemplate | null; onDone: () => void }) {
  const deleteMutation = useDeletePromptTemplate();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-500">{error}</span>}
      <AlertDialogAction
        onClick={async () => {
          if (!template) return;
          try {
            await deleteMutation.mutateAsync(template.id);
            onDone();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to delete");
          }
        }}
        className="bg-red-600 text-white hover:bg-red-700"
      >
        Delete
      </AlertDialogAction>
    </div>
  );
}
