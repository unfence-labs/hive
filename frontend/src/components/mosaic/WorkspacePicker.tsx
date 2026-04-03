import { useMemo, type ReactNode } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { ProjectAvatar } from "@/components/ProjectAvatar";
import { BranchLabel } from "@/components/BranchLabel";
import AgentActivityPreview from "@/components/chat/AgentActivityPreview";
import { parseProjectOwnerRepo } from "@/components/Sidebar";
import { useProjects } from "@/hooks/useProjects";
import { useWorkspaceLiveDataContext } from "@/contexts/WorkspaceLiveDataContext";
import { MAX_MOSAIC, parseTileId } from "@/hooks/useMosaicWorkspaces";
import { cn } from "@/lib/utils";

interface WorkspacePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
  onToggle: (wsId: string) => void;
  children: ReactNode;
}

export function WorkspacePicker({
  open,
  onOpenChange,
  selectedIds,
  onToggle,
  children,
}: WorkspacePickerProps) {
  const { projects } = useProjects();
  const liveData = useWorkspaceLiveDataContext();

  const selectedWsIds = useMemo(
    () => new Set(selectedIds.map((id) => parseTileId(id).wsId)),
    [selectedIds],
  );
  const atMax = selectedIds.length >= MAX_MOSAIC;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        {children}
      </PopoverTrigger>

      <PopoverContent className="w-80 p-0">
        <div className="border-b border-border px-3 py-2.5">
          <p className="text-sm font-medium">Choose workspaces</p>
          <p className="text-xs text-muted-foreground">
            Select up to {MAX_MOSAIC} workspaces to display in mosaic view.
          </p>
        </div>

        <ScrollArea className="max-h-[360px]">
          <TooltipProvider delayDuration={400}>
          <div className="space-y-4 p-3">
            {projects.map((project) => {
              const workspaces = project.workspaces ?? [];
              if (workspaces.length === 0) return null;

              const parsed = parseProjectOwnerRepo(project.url);
              const label = parsed
                ? `${parsed.owner}/${parsed.repo}`
                : project.name;

              return (
                <div key={project.id}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <ProjectAvatar
                      name={project.name}
                      projectId={project.id}
                      hasFavicon={project.hasFavicon}
                      className="h-4 w-4"
                    />
                    <span className="text-xs font-semibold lowercase tracking-wider text-muted-foreground">
                      {label}
                    </span>
                  </div>

                  <div className="space-y-1">
                    {workspaces.map((ws) => {
                      const isSelected = selectedWsIds.has(ws.id);
                      const wsLive = liveData[ws.id];
                      const streaming = wsLive?.streaming ?? false;
                      const displayBranch = wsLive?.branch ?? ws.branch;
                      const disabled = !isSelected && atMax;

                      const btn = (
                        <button
                          key={ws.id}
                          type="button"
                          disabled={disabled}
                          onClick={() => onToggle(ws.id)}
                          className={cn(
                            "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
                            "hover:bg-muted/50",
                            disabled && "pointer-events-none opacity-40",
                          )}
                        >
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => onToggle(ws.id)}
                            disabled={disabled}
                            tabIndex={-1}
                            className="pointer-events-none"
                          />

                          <div className="flex min-w-0 flex-1 items-center gap-1.5">
                            <span className="truncate text-sm">{ws.name}</span>
                            {displayBranch && (
                              <>
                                <span className="text-muted-foreground/40">·</span>
                                <BranchLabel
                                  branch={displayBranch}
                                  showIcon={false}
                                  className="truncate text-xs text-muted-foreground"
                                />
                              </>
                            )}
                          </div>

                          {streaming && (
                            <AgentActivityPreview size="small" />
                          )}
                        </button>
                      );

                      if (disabled) {
                        return (
                          <Tooltip key={ws.id}>
                            <TooltipTrigger asChild>
                              <span className="block w-full cursor-not-allowed">{btn}</span>
                            </TooltipTrigger>
                            <TooltipContent side="right">
                              Maximum {MAX_MOSAIC} workspaces
                            </TooltipContent>
                          </Tooltip>
                        );
                      }

                      return btn;
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          </TooltipProvider>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
