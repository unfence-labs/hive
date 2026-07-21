import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ContentPanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function ContentPanel({ children, className, ...props }: ContentPanelProps) {
  return (
    <div
      className={cn("mt-1.5 mb-3 overflow-hidden rounded-lg border border-border/60 bg-field text-xs", className)}
      {...props}
    >
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
    <div className={cn("border-t border-border/60 bg-card px-3 py-2.5 dark:bg-sidebar", className)}>
      {children}
    </div>
  );
}
