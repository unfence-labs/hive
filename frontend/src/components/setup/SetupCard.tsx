import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The shell every setup card shares: a title, a one-line status under it,
 * actions on the right, and room below for whatever the card has to open —
 * a device-code prompt, an error panel.
 *
 * Slots rather than flags. The cards that use it (agent harness, GitHub,
 * access token) differ only in what they put in each slot, so there is nothing
 * here to switch on, and dimming a card is left to the caller's `className`.
 */
export function SetupCard({
  title,
  titleAdornment,
  status,
  actions,
  className,
  children,
}: {
  title: string;
  /** Sits next to the title, e.g. the providers a harness serves. */
  titleAdornment?: ReactNode;
  status: ReactNode;
  actions: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section className={cn("rounded-lg border border-border/50 bg-card/50 px-4 py-3", className)}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-foreground">{title}</h3>
            {titleAdornment}
          </div>
          <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">{status}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      </div>

      {children}
    </section>
  );
}
