import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ContentPanelProps {
  children: ReactNode;
  className?: string;
}

export function ContentPanel({ children, className }: ContentPanelProps) {
  return (
    <div className={cn("mt-1.5 mb-3 overflow-hidden rounded-lg border border-border/60 bg-muted/20 dark:bg-input/30 text-xs", className)}>
      {children}
    </div>
  );
}

export function ContentPanelBody({ children, className }: ContentPanelProps) {
  return (
    <div className={cn("px-3 py-2.5", className)}>
      {children}
    </div>
  );
}

export function ContentPanelFooter({ children, className }: ContentPanelProps) {
  return (
    <div className={cn("border-t border-border/60 bg-black/5 dark:bg-white/[0.03] px-3 py-2.5", className)}>
      {children}
    </div>
  );
}
