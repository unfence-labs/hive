import { X } from "lucide-react";
import type { PointerEvent } from "react";
import { Toaster } from "sonner";
import "sonner/dist/styles.css";

import { useThemeType } from "@/hooks/useThemeType";
import { useToastPosition } from "@/hooks/useToastPosition";

export type HiveToastVariant = "success" | "error" | "warning";

const VARIANT_COLORS: Record<HiveToastVariant, { accent: string; statusText: string }> = {
  success: {
    accent: "var(--success)",
    statusText: "var(--success-foreground)",
  },
  error: {
    accent: "var(--destructive)",
    statusText: "var(--destructive)",
  },
  warning: {
    accent: "var(--warning)",
    statusText: "var(--warning-foreground)",
  },
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

function stopSwipeGesture(event: PointerEvent<HTMLButtonElement>) {
  event.stopPropagation();
}

/**
 * Refined Minimal toast — flat surface, status dot with a soft ring, a mono
 * status word, a quiet ghost action, and a discreet close button.
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
  const colors = VARIANT_COLORS[variant];

  return (
    <div className="pointer-events-auto flex w-[min(380px,calc(100vw-2rem))] items-start gap-3 rounded-lg border border-border bg-popover px-4 py-3.5 text-popover-foreground shadow-[var(--center-card-shadow)]">
      <span
        className="mt-1.5 size-2 shrink-0 rounded-full"
        style={{
          background: colors.accent,
          boxShadow: `0 0 0 3px color-mix(in oklch, ${colors.accent} 18%, transparent)`,
        }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium leading-5 text-foreground">{title}</span>
          <span
            className="shrink-0 font-mono text-[10px] font-medium uppercase tracking-wider"
            style={{ color: colors.statusText }}
          >
            {status}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {actionLabel ? (
          <button
            type="button"
            onPointerDown={stopSwipeGesture}
            onClick={onAction}
            className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {actionLabel}
          </button>
        ) : null}
        <button
          type="button"
          onPointerDown={stopSwipeGesture}
          onClick={onClose}
          aria-label="Dismiss"
          className="flex size-7 cursor-pointer items-center justify-center rounded text-muted-foreground opacity-60 transition-[color,background-color,opacity] hover:bg-accent hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <X className="size-3" />
        </button>
      </div>
    </div>
  );
}

export function HiveToaster() {
  const theme = useThemeType();
  const { position } = useToastPosition();

  return (
    <Toaster
      expand={false}
      gap={10}
      mobileOffset={16}
      offset={18}
      position={position}
      theme={theme}
      visibleToasts={3}
      // Toasts are rendered as fully custom <HiveToast> nodes, so the sonner
      // wrapper must stay bare (no default card chrome around our component).
      toastOptions={{ unstyled: true }}
    />
  );
}
