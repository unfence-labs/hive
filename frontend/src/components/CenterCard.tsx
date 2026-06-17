import { cn } from "@/lib/utils";

/**
 * The elevated central surface shared by every main-panel view (Workspace,
 * Brain, Settings, automations). It floats above the shell background with a
 * rounded border + shadow, while the page header stays on the shell above it.
 * This is the single source of truth for the card's look — tune radius, gutters
 * and shadow here and every view follows.
 *
 * Pass `scroll` for pages whose body should scroll as a whole; omit it for
 * pages that manage their own internal scroll regions (e.g. split layouts).
 *
 * The card keeps a real margin on all four sides: that gutter is where the
 * elevation shadow renders (it sits inside the panel, so it is not clipped) and
 * it doubles as the resize gutter. Resize separators next to a card are pulled
 * into this margin gutter (see ResizeHandle `cardSide`) so the hit target sits
 * flush against the card edge without adding any layout width.
 */
export function CenterCard({
  children,
  className,
  scroll = false,
}: {
  children: React.ReactNode;
  className?: string;
  scroll?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative m-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-card shadow-[0_2px_10px_-5px_rgba(0,0,0,0.12),0_0_6px_-3px_rgba(0,0,0,0.05)]",
        className,
      )}
    >
      {scroll ? <div className="min-h-0 flex-1 overflow-auto">{children}</div> : children}
    </div>
  );
}
