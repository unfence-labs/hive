import { Loader2, Plus } from "lucide-react";
import { CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface SidebarGroupHeaderProps {
  icon: React.ReactNode;
  label: React.ReactNode;
  badge?: React.ReactNode;
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

  return (
    <div className="group relative flex w-full items-center">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full min-w-0 items-center overflow-hidden text-left transition-colors",
            isPlain
              ? "gap-1.5 px-0 py-0.5"
              : "gap-2 rounded px-2 py-1 hover:bg-sidebar-accent/40",
            count !== undefined && "pr-7",
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
      {count !== undefined && (
        <div className={cn("absolute inset-y-0 flex items-center", isPlain ? "right-0" : "right-2")}>
          <div className="relative flex h-5 w-5 items-center justify-center">
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : (
              <>
                <span className="text-xs tabular-nums text-muted-foreground/60 transition-opacity group-hover:opacity-0">
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
}: SidebarSectionHeaderProps) {
  return (
    <div className={cn("group relative flex w-full items-center", className)}>
      <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
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
    </div>
  );
}
