import { X } from "lucide-react";
import { Toaster } from "sonner";
import "sonner/dist/styles.css";

import { useThemeType } from "@/hooks/useThemeType";

export type HiveToastVariant = "success" | "error" | "warning";

const VARIANT_COLOR: Record<HiveToastVariant, string> = {
  success: "var(--success)",
  error: "var(--destructive)",
  warning: "var(--warning)",
};

export interface HiveToastProps {
  variant: HiveToastVariant;
  /** Workspace label, e.g. "project · branch". */
  title: string;
  /** Short uppercase status word, e.g. "DONE" / "FAILED" / "INPUT". */
  status: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  onClose: () => void;
}

/**
 * Refined Minimal toast — flat surface, status dot with a soft ring, a mono
 * status word, a quiet ghost action, and a hover/focus-revealed close button.
 */
export function HiveToast({
  variant,
  title,
  status,
  description,
  actionLabel,
  onAction,
  onClose,
}: HiveToastProps) {
  const color = VARIANT_COLOR[variant];

  return (
    <div className="group pointer-events-auto relative flex w-[min(380px,calc(100vw-2rem))] items-start gap-3 rounded-lg border border-border bg-popover px-4 py-3.5 text-popover-foreground shadow-lg shadow-black/10 dark:shadow-black/30">
      <span
        className="mt-1.5 size-2 shrink-0 rounded-full"
        style={{
          background: color,
          boxShadow: `0 0 0 3px color-mix(in oklch, ${color} 18%, transparent)`,
        }}
      />
      <div className="min-w-0 flex-1 pr-5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium leading-5 text-foreground">{title}</span>
          <span
            className="shrink-0 font-mono text-[10px] font-medium uppercase tracking-wider"
            style={{ color }}
          >
            {status}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      {actionLabel ? (
        <button
          type="button"
          onClick={onAction}
          className="shrink-0 cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {actionLabel}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        className="absolute right-1.5 top-1.5 flex size-5 cursor-pointer items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity pointer-events-none hover:bg-accent hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 group-hover:pointer-events-auto group-hover:opacity-100"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

export function HiveToaster() {
  const theme = useThemeType();

  return (
    <Toaster
      expand={false}
      gap={10}
      mobileOffset={16}
      offset={18}
      position="bottom-left"
      theme={theme}
      visibleToasts={3}
      swipeDirections={["left"]}
      // Toasts are rendered as fully custom <HiveToast> nodes, so the sonner
      // wrapper must stay bare (no default card chrome around our component).
      toastOptions={{ unstyled: true }}
    />
  );
}
