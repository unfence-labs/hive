import { useEffect, useRef } from "react";
import { Spinner } from "@/components/ui/spinner";

export function AppResyncOverlay() {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    overlayRef.current?.focus();
    return () => {
      if (previousFocus?.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/20 backdrop-blur-sm outline-none"
      role="status"
      aria-live="polite"
      aria-label="Syncing Hive"
      tabIndex={-1}
      onKeyDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-background/90 px-4 py-3 text-sm font-medium text-foreground shadow-lg">
        <Spinner className="size-4 text-muted-foreground" />
        <span>Syncing Hive…</span>
      </div>
    </div>
  );
}
