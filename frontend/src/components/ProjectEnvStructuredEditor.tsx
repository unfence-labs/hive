import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Eye, EyeOff, FileUp, Plus, X } from "lucide-react";
import { nanoid } from "nanoid";
import {
  hasProjectEnvValueLineBreaks,
  isValidProjectEnvKey,
  parseProjectEnvContent,
  type ProjectEnvConfig,
  type ProjectEnvVariable,
} from "@hive/shared/project-env";
import { CopyButton } from "@/components/chat/CopyButton";
import { EnvEditor } from "@/components/EnvEditor";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface ProjectEnvStructuredEditorProps {
  value: ProjectEnvConfig;
  onChange: (value: ProjectEnvConfig) => void;
  readOnly?: boolean;
}

export function ProjectEnvStructuredEditor({
  value,
  onChange,
  readOnly = false,
}: ProjectEnvStructuredEditorProps) {
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const keyCounts = useMemo(() => countKeys(value.variables), [value.variables]);
  const importedEntries = useMemo(() => parseProjectEnvContent(importText), [importText]);

  const updateVariable = (id: string, next: ProjectEnvVariable) => {
    onChange({
      variables: value.variables.map((variable) => (variable.id === id ? next : variable)),
    });
  };

  const deleteVariable = (id: string) => {
    onChange({ variables: value.variables.filter((variable) => variable.id !== id) });
  };

  const addVariable = () => {
    onChange({
      variables: [
        ...value.variables,
        { id: nanoid(), key: "", value: "", comment: "" },
      ],
    });
  };

  const openImportDialog = () => {
    setImportText("");
    setImportOpen(true);
  };

  const handleImport = () => {
    if (importedEntries.length === 0) return;

    onChange({
      variables: [
        ...value.variables,
        ...importedEntries.map((entry) => ({
          id: nanoid(),
          key: entry.key,
          value: entry.value,
          comment: "",
        })),
      ],
    });
    setImportText("");
    setImportOpen(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={readOnly}
          onClick={addVariable}
          className="border-border/50 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
          Variable
        </Button>
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={readOnly}
          onClick={openImportDialog}
          className="border-border/50 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        >
          <FileUp className="h-3.5 w-3.5" />
          Import .env
        </Button>
      </div>

      {value.variables.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/60 bg-background/50 p-5 text-center">
          <p className="text-sm font-medium text-foreground">No variables configured</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add a variable when this project needs a generated workspace .env file.
          </p>
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-[minmax(8rem,0.85fr)_minmax(10rem,1fr)_minmax(8rem,1fr)_2rem] gap-3 border-b border-border/50 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <span>Key</span>
            <span>Value</span>
            <span>Comment</span>
            <span className="sr-only">Actions</span>
          </div>
          {value.variables.map((variable) => (
            <VariableRow
              key={variable.id}
              variable={variable}
              duplicate={keyCounts.get(variable.key.trim()) !== undefined && (keyCounts.get(variable.key.trim()) ?? 0) > 1}
              readOnly={readOnly}
              onChange={(next) => updateVariable(variable.id, next)}
              onDelete={() => deleteVariable(variable.id)}
            />
          ))}
        </div>
      )}

      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          setImportOpen(open);
          if (!open) setImportText("");
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import .env</DialogTitle>
            <DialogDescription>
              Paste raw .env content. Comments are ignored and each key-value pair is added as a variable.
            </DialogDescription>
          </DialogHeader>
          <EnvEditor
            value={importText}
            onChange={setImportText}
            maxHeight="18rem"
            ariaLabel="Raw environment file"
            className="bg-background/70"
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              disabled={importedEntries.length === 0}
              onClick={handleImport}
            >
              <FileUp className="h-3.5 w-3.5" />
              Import variables
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VariableRow({
  variable,
  duplicate,
  readOnly,
  onChange,
  onDelete,
}: {
  variable: ProjectEnvVariable;
  duplicate: boolean;
  readOnly: boolean;
  onChange: (variable: ProjectEnvVariable) => void;
  onDelete: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const key = variable.key.trim();
  const keyError = getKeyError(key, duplicate);
  const valueError = hasProjectEnvValueLineBreaks(variable.value) ? "Value cannot contain line breaks" : null;

  return (
    <div className={cn(
      "grid items-start gap-3 py-2",
      "sm:grid-cols-[minmax(8rem,0.85fr)_minmax(10rem,1fr)_minmax(8rem,1fr)_2rem]",
    )}>
      <div>
        <Input
          value={variable.key}
          disabled={readOnly}
          onChange={(event) => onChange({ ...variable, key: event.target.value })}
          placeholder="API_KEY"
          aria-label="Environment variable key"
          aria-invalid={Boolean(keyError) || undefined}
          className="h-8 font-mono text-xs"
        />
        {keyError && <p className="mt-1 text-[11px] text-destructive">{keyError}</p>}
      </div>

      <div>
        <div className="relative">
          <Input
            value={variable.value}
            disabled={readOnly}
            type={revealed ? "text" : "password"}
            onChange={(event) => onChange({ ...variable, value: event.target.value })}
            placeholder="value"
            aria-label="Environment variable value"
            aria-invalid={Boolean(valueError) || undefined}
            className="h-8 pr-16 font-mono text-xs"
          />
          <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1">
            <IconButton label={revealed ? "Hide value" : "Reveal value"} onClick={() => setRevealed(!revealed)}>
              {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </IconButton>
            <CopyButton
              content={variable.value}
              disabled={!variable.value}
              ariaLabel="Copy value"
              copiedAriaLabel="Value copied"
              iconClassName="h-3.5 w-3.5"
              className="h-7 w-7 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            />
          </div>
        </div>
        {valueError && <p className="mt-1 text-[11px] text-destructive">{valueError}</p>}
      </div>

      <Input
        value={variable.comment ?? ""}
        disabled={readOnly}
        onChange={(event) => onChange({ ...variable, comment: event.target.value })}
        placeholder="Comment"
        aria-label="Environment variable comment"
        className="h-8 text-xs"
      />

      <div className="flex h-8 items-center justify-end">
        <IconButton label="Remove variable" disabled={readOnly} onClick={onDelete}>
          <X className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    </div>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="text-muted-foreground hover:bg-muted/50 hover:text-foreground"
    >
      {children}
    </Button>
  );
}

function countKeys(variables: ProjectEnvVariable[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const variable of variables) {
    const key = variable.key.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function getKeyError(key: string, duplicate: boolean): string | null {
  if (!key) return "Key is required";
  if (!isValidProjectEnvKey(key)) return "Use letters, numbers, and underscores only";
  if (duplicate) return "Duplicate key";
  return null;
}
