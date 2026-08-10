import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The body of a settings page: a single column of sections laid directly on the
 * {@link CenterCard} surface.
 *
 * The card already provides the border, background and elevation, so sections
 * inside it carry no chrome of their own — drawing a second bordered box on top
 * of the card only doubles the frame. Sections are told apart by a hairline
 * rule and whitespace instead.
 */
export function SettingsPanel({
  children,
  className,
  wide = false,
}: {
  children: ReactNode;
  className?: string;
  /** Wider column for dense, table-like pages (e.g. a project's details). */
  wide?: boolean;
  }) {
  return (
    <div className={cn("px-6 py-3", wide ? "max-w-4xl" : "max-w-2xl", className)}>{children}</div>
  );
}

/**
 * One titled block inside a {@link SettingsPanel}. The rule belongs to the
 * section rather than the panel so conditionally rendered sections cannot leave
 * a dangling divider behind.
 */
export function SettingsSection({
  title,
  description,
  action,
  children,
  role,
}: {
  /** Accepts a node so a section can inline a badge next to its heading. */
  title?: ReactNode;
  description?: ReactNode;
  /** Trailing control on the heading row, e.g. a button or a toggle. */
  action?: ReactNode;
  children?: ReactNode;
  role?: string;
}) {
  return (
    <section className="border-b border-border/50 py-6 last:border-b-0" role={role}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {typeof title === "string" ? (
              <h2 className="text-sm font-medium text-foreground">{title}</h2>
            ) : (
              title
            )}
            {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
