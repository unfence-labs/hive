import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const settingsFocusClass = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
const settingsResourceScrollClassName =
  "[&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!min-w-full [&_[data-slot=scroll-area-viewport]>div]:!w-full";

export function SettingsResourceList({
  children,
  empty,
  showEmpty,
  actionLabel,
  actionActive,
  onAction,
}: {
  children: ReactNode;
  empty: ReactNode;
  showEmpty: boolean;
  actionLabel: string;
  actionActive: boolean;
  onAction: () => void;
}) {
  return (
    <div className="flex w-64 shrink-0 flex-col border-r border-border/50 max-md:h-56 max-md:w-full max-md:border-r-0 max-md:border-b">
      <ScrollArea className={cn("flex-1", settingsResourceScrollClassName)}>
        <div className="p-2">{showEmpty ? empty : children}</div>
      </ScrollArea>
      <div className="border-t border-border/30 p-2">
        <button
          type="button"
          onClick={onAction}
          className={cn(
            "inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-primary/40 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:border-primary hover:bg-primary/10",
            settingsFocusClass,
            actionActive && "border-primary bg-primary/10",
          )}
        >
          <Plus aria-hidden="true" className="h-3 w-3" />
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

export function SettingsResourceEmptyList({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 py-8 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}

export function SettingsResourceListItem({
  icon,
  title,
  description,
  trailing,
  ariaLabel,
  selected,
  onClick,
}: {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  ariaLabel?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn(
        "mb-1 flex w-full cursor-pointer flex-col gap-1.5 rounded-md px-2 py-2 text-left text-sm transition-colors",
        settingsFocusClass,
        selected
          ? "bg-primary/15 text-foreground"
          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span aria-hidden="true" className="shrink-0">
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
        {trailing}
      </div>
      {description && (
        <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">
          {description}
        </p>
      )}
    </button>
  );
}

export function SettingsEmptySelection({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
