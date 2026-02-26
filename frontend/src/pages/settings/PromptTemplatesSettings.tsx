import { useState } from "react";
import { Loader2, Plus, Pencil, Trash2, Save, X } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { SettingsHeader } from "@/components/AppLayout";
import {
  usePromptTemplates,
  useCreatePromptTemplate,
  useUpdatePromptTemplate,
  useDeletePromptTemplate,
} from "@/hooks/usePromptTemplates";
import { cn } from "@/lib/utils";
import type { PromptTemplate } from "@/types";

export default function PromptTemplatesSettings() {
  const { data: templates, isLoading } = usePromptTemplates();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PromptTemplate | null>(null);

  const systemTemplates = templates?.filter((t) => t.type === "system") ?? [];
  const userTemplates = templates?.filter((t) => t.type === "user") ?? [];

  if (isLoading) return null;

  return (
    <div className="flex h-full flex-col overflow-auto">
      <SettingsHeader>
        <h1 className="text-sm font-medium">Prompt Templates</h1>
      </SettingsHeader>

      <div className="max-w-2xl space-y-6 px-4 py-5">
        <p className="text-xs text-muted-foreground">
          Reusable system and user prompts for your automations.
        </p>

        {/* Create button */}
        {!showCreate && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          >
            <Plus className="h-3 w-3" />
            Add Template
          </button>
        )}

        {/* Create form */}
        {showCreate && (
          <CreateTemplateForm onClose={() => setShowCreate(false)} />
        )}

        {/* System Templates */}
        {systemTemplates.length > 0 && (
          <TemplateGroup
            label="System Prompts"
            templates={systemTemplates}
            editingId={editingId}
            onEdit={setEditingId}
            onDelete={setDeleteTarget}
          />
        )}

        {/* User Templates */}
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
                  "rounded-md px-3 py-1 text-xs font-medium transition-colors",
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
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={type === "system" ? "You are a code auditor..." : "Review the codebase and..."}
            rows={6}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!isValid || createMutation.isPending}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90",
              (!isValid || createMutation.isPending) && "pointer-events-none opacity-60",
            )}
          >
            {createMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Save
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
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
            className="rounded p-1 text-muted-foreground hover:text-foreground"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded p-1 text-muted-foreground hover:text-red-400"
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
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={6}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!isValid || updateMutation.isPending}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground",
              (!isValid || updateMutation.isPending) && "pointer-events-none opacity-60",
            )}
          >
            {updateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Save
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
