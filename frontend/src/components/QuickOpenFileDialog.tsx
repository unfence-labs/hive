import { useEffect, useMemo, useState } from "react";
import { FileIcon } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useFileCompletions } from "@/hooks/useFileCompletions";
import { fuzzyMatchFiles } from "@/lib/fuzzy-match";

const MAX_RESULTS = 50;

interface QuickOpenFileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  onSelect: (path: string) => void;
}

export function QuickOpenFileDialog({
  open,
  onOpenChange,
  workspaceId,
  onSelect,
}: QuickOpenFileDialogProps) {
  const files = useFileCompletions(workspaceId);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const results = useMemo(
    () => fuzzyMatchFiles(files, query, MAX_RESULTS),
    [files, query],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Quick open file"
      description="Search workspace files"
      showCloseButton={false}
      className="top-[20%] translate-y-0 sm:max-w-xl"
      shouldFilter={false}
    >
      <CommandInput
        placeholder="Search files by path…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No files found.</CommandEmpty>
        <CommandGroup heading="Files">
          {results.map(({ path, basename }) => {
            const dirPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
            return (
              <CommandItem
                key={path}
                value={path}
                onSelect={() => {
                  onOpenChange(false);
                  onSelect(path);
                }}
              >
                <FileIcon />
                <span className="shrink-0">{basename}</span>
                {dirPath && (
                  <span className="truncate text-xs text-muted-foreground">{dirPath}</span>
                )}
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
