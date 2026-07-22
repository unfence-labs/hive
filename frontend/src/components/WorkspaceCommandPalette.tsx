import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  FileSearch,
  GitBranch,
  MessageSquarePlus,
  Plus,
  RotateCcw,
  Search,
  Settings,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
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
  workspaceCommandsEnabled: boolean;
  onCommand: (command: CommandPaletteAction) => void;
}

export type CommandPaletteAction =
  | "new-workspace"
  | "new-workspace-from"
  | "settings"
  | "zoom-in"
  | "zoom-out"
  | "reset-zoom"
  | "back"
  | "forward"
  | "previous-tab"
  | "next-tab"
  | "new-chat"
  | "quick-open-file"
  | "find-next"
  | "find-previous";

/** ⌘K spotlight for global, navigation, workspace, and conversation actions. */
export function WorkspaceCommandPalette({
  open,
  onOpenChange,
  workspaceCommandsEnabled,
  onCommand,
}: WorkspaceCommandPaletteProps) {
  const run = (command: CommandPaletteAction) => {
    onOpenChange(false);
    onCommand(command);
  };

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
            onSelect={() => run("new-workspace")}
          >
            <Plus />
            New workspace
            <CommandShortcut>{shortcutLabel("N")}</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => run("new-workspace-from")}
          >
            <GitBranch />
            New workspace from…
            <CommandShortcut>{shortcutLabel("N", { shift: true })}</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Conversation actions">
          <CommandItem
            disabled={!workspaceCommandsEnabled}
            onSelect={() => run("new-chat")}
          >
            <MessageSquarePlus />
            New conversation
            <CommandShortcut>{shortcutLabel("T")}</CommandShortcut>
          </CommandItem>
          <CommandItem
            disabled={!workspaceCommandsEnabled}
            onSelect={() => run("quick-open-file")}
          >
            <FileSearch />
            Quick open file
            <CommandShortcut>{shortcutLabel("P")}</CommandShortcut>
          </CommandItem>
          <CommandItem
            disabled={!workspaceCommandsEnabled}
            onSelect={() => run("previous-tab")}
          >
            <ChevronLeft />
            Previous tab
            <CommandShortcut>
              {shortcutLabel("[", { shift: true })} / {shortcutLabel("Tab", { shift: true, control: true, command: false })}
            </CommandShortcut>
          </CommandItem>
          <CommandItem
            disabled={!workspaceCommandsEnabled}
            onSelect={() => run("next-tab")}
          >
            <ChevronRight />
            Next tab
            <CommandShortcut>
              {shortcutLabel("]", { shift: true })} / {shortcutLabel("Tab", { control: true, command: false })}
            </CommandShortcut>
          </CommandItem>
          <CommandItem
            disabled={!workspaceCommandsEnabled}
            onSelect={() => run("find-next")}
          >
            <Search />
            Find next match
            <CommandShortcut>{shortcutLabel("G")}</CommandShortcut>
          </CommandItem>
          <CommandItem
            disabled={!workspaceCommandsEnabled}
            onSelect={() => run("find-previous")}
          >
            <Search />
            Find previous match
            <CommandShortcut>{shortcutLabel("G", { shift: true })}</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => run("back")}>
            <ArrowLeft />
            Go back
            <CommandShortcut>{shortcutLabel("[")}</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run("forward")}>
            <ArrowRight />
            Go forward
            <CommandShortcut>{shortcutLabel("]")}</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Application">
          <CommandItem onSelect={() => run("settings")}>
            <Settings />
            Settings
            <CommandShortcut>{shortcutLabel(",")}</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run("zoom-in")}>
            <ZoomIn />
            Zoom in
            <CommandShortcut>{shortcutLabel("+")}</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run("zoom-out")}>
            <ZoomOut />
            Zoom out
            <CommandShortcut>{shortcutLabel("-")}</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run("reset-zoom")}>
            <RotateCcw />
            Reset zoom
            <CommandShortcut>{shortcutLabel("0")}</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
