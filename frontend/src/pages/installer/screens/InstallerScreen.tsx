import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { BackButton } from "./BackButton";
import { cn } from "@/lib/utils";

interface InstallerScreenProps {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  onContinue?: () => void;
  continueLabel?: string;
  continueDisabled?: boolean;
  onBack?: () => void;
  /** Extra action rendered to the left of the primary button. */
  footer?: ReactNode;
}

/**
 * Shared chrome for every installer step: title, body, and one fixed footer —
 * back sits bottom-left, the primary action bottom-right, on every screen.
 *
 * The footer is sticky: when the body outgrows the window it stays at the
 * bottom edge and the content scrolls behind it, fading out under a gradient
 * rather than clipping against an opaque edge. With short content the sticky
 * box rests at the end of the column and nothing looks different.
 */
export function InstallerScreen({
  title,
  description,
  children,
  onContinue,
  continueLabel = "Continue",
  continueDisabled,
  onBack,
  footer,
}: InstallerScreenProps) {
  const hasFooter = Boolean(onBack || onContinue || footer);
  return (
    <div
      className={cn(
        "mx-auto flex min-h-full w-full max-w-xl flex-col px-6 pt-10",
        !hasFooter && "pb-10",
      )}
    >
      <div className="flex-1">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        {description && <div className="mt-2 text-sm text-muted-foreground">{description}</div>}
        <div className="mt-6">{children}</div>
      </div>

      {hasFooter && (
        <div className="sticky bottom-0 mt-8 bg-background">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-6 left-0 right-0 h-6 bg-gradient-to-t from-background to-transparent"
          />
          <div className="flex items-center justify-between pb-8 pt-1">
            <div>{onBack && <BackButton onClick={onBack} />}</div>
            <div className="flex items-center gap-3">
              {footer}
              {onContinue && (
                <Button onClick={onContinue} disabled={continueDisabled}>
                  {continueLabel}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
