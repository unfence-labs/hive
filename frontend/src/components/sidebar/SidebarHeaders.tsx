import { Loader2, Plus } from "lucide-react";
import { CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface SidebarGroupHeaderProps {
  icon: React.ReactNode;
  label: React.ReactNode;
  badge?: React.ReactNode;
  activityIndicator?: React.ReactNode;
  count?: number;
  isLoading?: boolean;
  onAdd?: (e: React.MouseEvent) => void;
  addLabel?: string;
  variant?: "default" | "plain";
  buttonClassName?: string;
  buttonProps?: React.ComponentProps<"button">;
}

export function SidebarGroupHeader({
  icon,
  label,
  badge,
  activityIndicator,
  count,
  isLoading,
  onAdd,
  addLabel,
  variant = "default",
  buttonClassName,
  buttonProps,
}: SidebarGroupHeaderProps) {
  const isPlain = variant === "plain";
  const { className: buttonPropsClassName, ...restButtonProps } = buttonProps ?? {};
  const hasActivity = activityIndicator !== undefined && activityIndicator !== null && activityIndicator !== false;
  const hasCount = count !== undefined;
  // When both count and activity are shown, count takes the rightmost rail
  // and the activity indicator sits to its left. When only one is shown,
  // it takes the rightmost rail.
  const activitySlotRight = hasCount ? "right-6" : "right-0";
  const buttonRightPad = hasActivity && hasCount
    ? "pr-12"
    : hasCount || hasActivity
      ? "pr-6"
      : undefined;

  return (
    <div className="group relative flex w-full items-center">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full min-w-0 items-center text-left transition-colors",
            isPlain
              ? "gap-1.5 px-0 py-0.5"
              : "gap-2 rounded px-2 py-1 hover:bg-sidebar-accent/40",
            buttonRightPad,
            buttonClassName,
            buttonPropsClassName,
          )}
          {...restButtonProps}
        >
          {icon}
          <span className="min-w-0 flex-1 truncate text-xs font-semibold lowercase tracking-wider text-sidebar-foreground">
            {label}
          </span>
          {badge}
        </button>
      </CollapsibleTrigger>
      {hasActivity && (
        <div className={cn("pointer-events-none absolute inset-y-0 flex items-center", activitySlotRight)}>
          <div className="flex h-5 w-5 items-center justify-center">
            {activityIndicator}
          </div>
        </div>
      )}
      {hasCount && (
        // Offset by 3px so the count number's center lands on the workspace PR-dot
        // column below it (the dot sits at px-2 + half its w-2.5 cell = 13px from the
        // row's right edge, vs. this 20px-wide box's natural 10px center).
        <div className="absolute inset-y-0 right-[3px] flex items-center">
          <div className="relative flex h-5 w-5 items-center justify-center">
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : (
              <>
                <span className="text-[11px] font-medium tabular-nums tracking-tight text-muted-foreground/45 transition-opacity group-hover:opacity-0">
                  {count}
                </span>
                {onAdd && (
                  <button
                    type="button"
                    className="absolute inset-0 flex items-center justify-center text-muted-foreground opacity-0 transition-opacity hover:text-sidebar-foreground group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAdd(e);
                    }}
                    aria-label={addLabel}
                    title={addLabel}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface SidebarSectionHeaderProps {
  label: string;
  isLoading?: boolean;
  onAdd?: () => void;
  addLabel?: string;
  addDisabled?: boolean;
  className?: string;
  addIcon?: React.ReactNode;
  addButtonClassName?: string;
  /** Custom action buttons rendered in the header's action slot, replacing the default add button. */
  actions?: React.ReactNode;
}

export function SidebarSectionHeader({
  label,
  isLoading = false,
  onAdd,
  addLabel,
  addDisabled = false,
  className,
  addIcon,
  addButtonClassName,
  actions,
}: SidebarSectionHeaderProps) {
  return (
    <div className={cn("group relative flex w-full items-center", className)}>
      <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      {actions ? (
        <div className="flex items-center gap-0.5">{actions}</div>
      ) : (
      <div className="relative flex h-5 w-5 items-center justify-center">
        {isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : onAdd ? (
          <button
            type="button"
            className={cn(
              "flex items-center justify-center text-muted-foreground/70 transition-colors hover:text-sidebar-foreground disabled:pointer-events-none disabled:opacity-40",
              addButtonClassName,
            )}
            onClick={onAdd}
            disabled={addDisabled}
            aria-label={addLabel}
            title={addLabel}
          >
            {addIcon ?? <Plus className="h-4 w-4" />}
          </button>
        ) : null}
      </div>
      )}
    </div>
  );
}
