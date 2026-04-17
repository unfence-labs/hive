import { Check, FolderPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SidebarFolderComposerProps {
  isOpen: boolean;
  name: string;
  onNameChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function SidebarFolderComposer({
  isOpen,
  name,
  onNameChange,
  onSubmit,
  onCancel,
}: SidebarFolderComposerProps) {
  if (!isOpen) return null;

  return (
    <form
      className="mb-2 rounded-lg border border-sidebar-border/80 bg-sidebar-accent/25 p-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex items-center gap-2">
        <FolderPlus className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Input
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
          placeholder="Folder name"
          aria-label="Folder name"
          autoFocus
          className="h-8 bg-background/80 text-sm"
        />
        <Button
          type="submit"
          variant="ghost"
          size="icon-xs"
          disabled={name.trim().length === 0}
          aria-label="Create folder"
          title="Create folder"
        >
          <Check />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onCancel}
          aria-label="Cancel folder creation"
          title="Cancel folder creation"
        >
          <X />
        </Button>
      </div>
    </form>
  );
}
