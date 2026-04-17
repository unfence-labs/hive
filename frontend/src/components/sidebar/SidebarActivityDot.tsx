import { cn } from "@/lib/utils";
import type { ActivityState } from "@/lib/workspace-activity";

interface SidebarActivityDotProps {
  state: ActivityState;
  dimmed?: boolean;
  className?: string;
}

export function SidebarActivityDot({ state, dimmed, className }: SidebarActivityDotProps) {
  if (state === "idle") return null;

  const label =
    state === "streaming" ? "Agent is working" : "Unread activity";

  return (
    <span
      className={cn(
        "pointer-events-none absolute -top-1 -right-1 flex h-2.5 w-2.5 items-center justify-center",
        dimmed && "opacity-60",
        className,
      )}
      aria-label={label}
      role="status"
    >
      {state === "streaming" && (
        <span className="absolute inset-0 animate-ping rounded-full bg-primary/70" />
      )}
      <span className="relative h-2 w-2 rounded-full bg-primary shadow-[0_0_0_2px_var(--sidebar)]" />
    </span>
  );
}
