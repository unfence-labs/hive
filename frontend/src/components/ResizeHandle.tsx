import { Separator } from "react-resizable-panels";
import { cn } from "@/lib/utils";

interface ResizeHandleProps {
  orientation?: "horizontal" | "vertical";
  className?: string;
  disabled?: boolean;
}

export function ResizeHandle({
  orientation = "vertical",
  className,
  disabled,
}: ResizeHandleProps) {
  const isVertical = orientation === "vertical";

  return (
    <Separator
      disabled={disabled}
      style={{ outline: "none" }}
      className={cn(
        "group relative flex shrink-0 items-center justify-center bg-transparent",
        isVertical ? "w-1.5" : "h-1.5",
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
