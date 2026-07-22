import { GitBranch, Plus } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { shortcutLabel } from "@/lib/shortcuts";

interface WorkspaceCommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewWorkspace: () => void;
  onNewWorkspaceFrom: () => void;
}

/** ⌘K spotlight. Only workspace actions for now; more actions can join later. */
export function WorkspaceCommandPalette({
  open,
  onOpenChange,
  onNewWorkspace,
  onNewWorkspaceFrom,
}: WorkspaceCommandPaletteProps) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Type a command or search"
      showCloseButton={false}
      className="top-[20%] translate-y-0 sm:max-w-md"
    >
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Workspace actions">
          <CommandItem
            onSelect={() => {
              onOpenChange(false);
              onNewWorkspace();
            }}
          >
            <Plus />
            New workspace
            <CommandShortcut>{shortcutLabel("N")}</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              onOpenChange(false);
              onNewWorkspaceFrom();
            }}
          >
            <GitBranch />
            New workspace from…
            <CommandShortcut>{shortcutLabel("N", { shift: true })}</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
