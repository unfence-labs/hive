import { RefreshCw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { reloadHive } from "@/lib/reload-hive";

export function SidebarReloadButton() {
  return (
    <TooltipProvider>
      <Tooltip delayDuration={500}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={reloadHive}
            className="shrink-0 cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            aria-label="Reload Hive"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">Reload Hive</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
