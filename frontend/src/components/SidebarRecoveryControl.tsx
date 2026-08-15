import { RefreshCw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { reloadHive } from "@/lib/reload-hive";

export function SidebarRecoveryControl({ isResyncing = false }: { isResyncing?: boolean }) {
  if (isResyncing) {
    return (
      <span
        role="status"
        aria-live="polite"
        aria-label="Syncing Hive"
        className="flex h-6 shrink-0 items-center px-1 text-xs text-muted-foreground"
      >
        Syncing…
      </span>
    );
  }

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
