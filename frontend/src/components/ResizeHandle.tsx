import { Separator } from "react-resizable-panels";
import { cn } from "@/lib/utils";

interface ResizeHandleProps {
  orientation?: "horizontal" | "vertical";
  className?: string;
  disabled?: boolean;
  separator?: "before" | "after";
}

export function ResizeHandle({
  orientation = "vertical",
  className,
  disabled,
  separator,
}: ResizeHandleProps) {
  const isVertical = orientation === "vertical";
  const separatorClassName =
    separator === "before"
      ? isVertical
        ? "border-l border-sidebar-border/60"
        : "border-t border-sidebar-border/60"
      : separator === "after"
        ? isVertical
          ? "border-r border-sidebar-border/60"
          : "border-b border-sidebar-border/60"
        : undefined;

  return (
    <Separator
      disabled={disabled}
      style={{ outline: "none" }}
      className={cn(
        "group relative flex shrink-0 items-center justify-center bg-transparent",
        isVertical ? "w-1.5" : "h-1.5",
        separatorClassName,
        className,
      )}
    >
      <div
        className={cn(
          "rounded-full bg-border/50 transition-colors group-hover:bg-border group-data-[resize-handle-active]:bg-primary/60",
          isVertical ? "h-8 w-0.5" : "h-0.5 w-8",
        )}
      />
    </Separator>
  );
}
