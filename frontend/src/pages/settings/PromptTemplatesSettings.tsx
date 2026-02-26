import { useState } from "react";
import { Loader2, Plus, Pencil, Trash2, Save, X, RotateCcw, ChevronRight } from "lucide-react";
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
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
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
import { PromptEditor } from "@/components/PromptEditor";
import { cn } from "@/lib/utils";
import type { PromptTemplate } from "@/types";

// ── Main page ──────────────────────────────────────────────────────────

export default function PromptTemplatesSettings() {
  const { data: templates, isLoading: templatesLoading } = usePromptTemplates();
  const { isLoading: baseLoading } = useBasePrompt();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PromptTemplate | null>(null);

  const systemTemplates = templates?.filter((t) => t.type === "system") ?? [];
  const userTemplates = templates?.filter((t) => t.type === "user") ?? [];

  if (templatesLoading || baseLoading) return null;

  return (
    <div className="flex h-full flex-col overflow-auto">
      <SettingsHeader>
        <h1 className="text-sm font-medium">Prompts</h1>
      </SettingsHeader>

      <div className="max-w-2xl space-y-8 px-4 py-5">
        {/* ── Base System Prompt ──────────────────────────────────── */}
        <BasePromptSection />

        {/* ── Separator ──────────────────────────────────────────── */}
        <div className="border-t border-border/30" />

        {/* ── Template Library ────────────────────────────────────── */}
        <div className="space-y-4">
          <div>
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
              Template Library
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Reusable system and user prompts for your automations.
            </p>
          </div>

          {!showCreate && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            >
              <Plus className="h-3 w-3" />
              Add Template
            </button>
          )}

          {showCreate && (
            <CreateTemplateForm onClose={() => setShowCreate(false)} />
          )}

          {systemTemplates.length > 0 && (
            <TemplateGroup
              label="System Prompts"
              templates={systemTemplates}
              editingId={editingId}
              onEdit={setEditingId}
              onDelete={setDeleteTarget}
            />
          )}

          {userTemplates.length > 0 && (
            <TemplateGroup
              label="User Prompts"
              templates={userTemplates}
              editingId={editingId}
              onEdit={setEditingId}
              onDelete={setDeleteTarget}
            />
          )}

          {systemTemplates.length === 0 && userTemplates.length === 0 && !showCreate && (
            <p className="text-sm text-muted-foreground">No templates yet.</p>
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{deleteTarget?.name}"? This cannot be undone. Templates referenced by automations cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <DeleteButton template={deleteTarget} onDone={() => setDeleteTarget(null)} />
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Base System Prompt ─────────────────────────────────────────────────

const TEMPLATE_VARIABLES = [
  { token: "{DIR}", desc: "workspace path" },
  { token: "{DEFAULT_BRANCH}", desc: "target branch" },
  { token: "{PROJECT}", desc: "project name" },
] as const;

function BasePromptSection() {
  const { data } = useBasePrompt();
  const updateMutation = useUpdateBasePrompt();
  const resetMutation = useResetBasePrompt();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showDefault, setShowDefault] = useState(false);

  if (!data) return null;

  const startEdit = () => {
    setDraft(data.content);
    setEditing(true);
  };

  const handleSave = async () => {
    if (!draft.trim()) return;
    await updateMutation.mutateAsync(draft);
    setEditing(false);
  };

  const handleReset = async () => {
    await resetMutation.mutateAsync();
    setShowResetConfirm(false);
    setEditing(false);
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
          Base System Prompt
        </h2>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium",
            data.isDefault
              ? "bg-muted text-muted-foreground"
              : "bg-primary/10 text-primary",
          )}
        >
          {data.isDefault ? "Default" : "Custom"}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Injected into every agent session. Supports template variables.
      </p>

      {editing ? (
        <div className="space-y-3 rounded-lg border border-primary/30 bg-card/50 p-4">
          <PromptEditor value={draft} onChange={setDraft} maxHeight="24rem" />

          {/* Template variables hint */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground/70">
            <span className="font-medium text-muted-foreground">Variables:</span>
            {TEMPLATE_VARIABLES.map((v) => (
              <span key={v.token}>
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">{v.token}</code>
                {" "}
                <span className="text-muted-foreground/50">{v.desc}</span>
              </span>
            ))}
          </div>

          {/* Collapsible default view */}
          {!data.isDefault && (
            <Collapsible open={showDefault} onOpenChange={setShowDefault}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ChevronRight
                    className={cn(
                      "h-3 w-3 transition-transform",
                      showDefault && "rotate-90",
                    )}
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
          )}

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!draft.trim() || updateMutation.isPending}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90",
                (!draft.trim() || updateMutation.isPending) && "pointer-events-none opacity-60",
              )}
            >
              {updateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save
            </button>
            <button
              type="button"
              onClick={() => { setEditing(false); setShowDefault(false); }}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-3 w-3" />
              Cancel
            </button>
            {!data.isDefault && (
              <button
                type="button"
                onClick={() => setShowResetConfirm(true)}
                className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-red-400"
              >
                <RotateCcw className="h-3 w-3" />
                Reset to default
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="group rounded-lg border border-border/50 bg-card/50 p-4">
          <div className="flex items-start justify-between">
            <p className="line-clamp-3 min-w-0 flex-1 whitespace-pre-wrap text-xs text-muted-foreground">
              {data.content}
            </p>
            <button
              type="button"
              onClick={startEdit}
              className="ml-2 shrink-0 cursor-pointer rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
            >
              <Pencil className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {/* Reset confirmation dialog */}
      <AlertDialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to default</AlertDialogTitle>
            <AlertDialogDescription>
              Your custom base prompt will be removed and replaced with the default system prompt. This cannot be undone.
            </AlertDialogDescription>
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
    </section>
  );
}

// ── Template Library components ────────────────────────────────────────

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

function CreateTemplateForm({ onClose }: { onClose: () => void }) {
  const createMutation = useCreatePromptTemplate();
  const [name, setName] = useState("");
  const [type, setType] = useState<"system" | "user">("system");
  const [content, setContent] = useState("");

  const isValid = name.trim() && content.trim();

  const handleSubmit = async () => {
    if (!isValid) return;
    await createMutation.mutateAsync({ name: name.trim(), type, content: content.trim() });
    onClose();
  };

  return (
    <section className="rounded-lg border border-border/50 bg-card/50 p-5">
      <div className="space-y-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Code Audit System Prompt"
            className="text-sm"
          />
        </div>

        <div>
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

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Content</label>
          <PromptEditor
            value={content}
            onChange={setContent}
            maxHeight="16rem"
            placeholder={type === "system" ? "You are a code auditor..." : "Review the codebase and..."}
          />
        </div>

        <div className="flex items-center gap-2">
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
            Save
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-3 w-3" />
            Cancel
          </button>
        </div>
      </div>
    </section>
  );
}

function TemplateGroup({
  label,
  templates,
  editingId,
  onEdit,
  onDelete,
}: {
  label: string;
  templates: PromptTemplate[];
  editingId: string | null;
  onEdit: (id: string | null) => void;
  onDelete: (t: PromptTemplate) => void;
}) {
  return (
    <div>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
        {label}
      </h2>
      <div className="space-y-2">
        {templates.map((tpl) =>
          editingId === tpl.id ? (
            <EditTemplateForm key={tpl.id} template={tpl} onClose={() => onEdit(null)} />
          ) : (
            <TemplateCard key={tpl.id} template={tpl} onEdit={() => onEdit(tpl.id)} onDelete={() => onDelete(tpl)} />
          ),
        )}
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  onEdit,
  onDelete,
}: {
  template: PromptTemplate;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const preview = template.content.split("\n").slice(0, 2).join("\n");

  return (
    <div className="group rounded-lg border border-border/50 bg-card/50 p-4">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium text-foreground">{template.name}</span>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{preview}</p>
        </div>
        <div className="ml-2 flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={onEdit}
            className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-red-400"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

function EditTemplateForm({ template, onClose }: { template: PromptTemplate; onClose: () => void }) {
  const updateMutation = useUpdatePromptTemplate();
  const [name, setName] = useState(template.name);
  const [content, setContent] = useState(template.content);

  const isValid = name.trim() && content.trim();

  const handleSave = async () => {
    if (!isValid) return;
    await updateMutation.mutateAsync({ id: template.id, name: name.trim(), content: content.trim() });
    onClose();
  };

  return (
    <div className="rounded-lg border border-primary/30 bg-card/50 p-4">
      <div className="space-y-3">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="text-sm"
        />
        <PromptEditor value={content} onChange={setContent} maxHeight="16rem" />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!isValid || updateMutation.isPending}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90",
              (!isValid || updateMutation.isPending) && "pointer-events-none opacity-60",
            )}
          >
            {updateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Save
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
