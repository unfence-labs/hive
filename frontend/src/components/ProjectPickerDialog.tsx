import { FolderGit2 } from "lucide-react";
import {
  SPOTLIGHT_DIALOG_CLASS,
  SPOTLIGHT_LIST_CLASS,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useProjects } from "@/hooks/useProjects";

interface ProjectPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (projectId: string) => void;
}

/**
 * ⌘N fallback when the target project is ambiguous: pick a project, then the
 * workspace is created instantly from the default branch — the source is never
 * in question here (that's the ⌘⇧N picker).
 */
export function ProjectPickerDialog({ open, onOpenChange, onSelect }: ProjectPickerDialogProps) {
  const { projects } = useProjects();
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New workspace"
      description="Choose a project"
      showCloseButton={false}
      className={SPOTLIGHT_DIALOG_CLASS}
    >
      <CommandInput placeholder="Choose a project for the new workspace…" />
      <CommandList className={SPOTLIGHT_LIST_CLASS}>
        <CommandEmpty>No projects found.</CommandEmpty>
        <CommandGroup heading="Projects">
          {projects.map((project) => (
            <CommandItem
              key={project.id}
              value={project.name}
              onSelect={() => {
                onOpenChange(false);
                onSelect(project.id);
              }}
            >
              <FolderGit2 />
              {project.name}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
