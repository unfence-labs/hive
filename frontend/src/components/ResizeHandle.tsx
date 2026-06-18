import { Separator } from "react-resizable-panels";
import { cn } from "@/lib/utils";

interface ResizeHandleProps {
  orientation?: "horizontal" | "vertical";
  className?: string;
  disabled?: boolean;
  separator?: "before" | "after";
  /**
   * Which side of the handle the elevated card sits on. The separator is pulled
   * (via negative margin, so it adds no layout width) into the card's margin
   * gutter and sits flush against the card edge — the resize hit target is glued
   * to the card while the card keeps its margin for the elevation shadow.
   *
   * The library hit-tests via getBoundingClientRect, so the shifted box is the
   * real hit area; `z-10` keeps it above the neighbouring panel it overlaps.
   * Leave unset for splits between non-card panels (they keep a thin gutter).
   */
  cardSide?: "left" | "right";
}

export function ResizeHandle({
  orientation = "vertical",
  className,
  disabled,
  separator,
  cardSide,
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

  const sizing =
    cardSide === "left"
      ? "relative z-10 w-2 -ml-2" // card on the left → overlap its right-margin gutter
      : cardSide === "right"
        ? "relative z-10 w-2 -mr-2" // card on the right → overlap its left-margin gutter
        : isVertical
          ? "w-1.5"
          : "h-1.5";

  return (
    <Separator
      disabled={disabled}
      style={{ outline: "none" }}
      className={cn(
        "shrink-0 bg-transparent",
        sizing,
        separatorClassName,
        className,
      )}
    />
  );
}
