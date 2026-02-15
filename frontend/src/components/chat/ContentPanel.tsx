import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ContentPanelProps {
  children: ReactNode;
  className?: string;
}

export function ContentPanel({ children, className }: ContentPanelProps) {
  return (
    <div className={cn("mt-1.5 overflow-hidden rounded-lg border border-border/60 text-xs", className)}>
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
    <div className={cn("border-t border-border/60 bg-muted/30 px-3 py-2.5", className)}>
      {children}
    </div>
  );
}
