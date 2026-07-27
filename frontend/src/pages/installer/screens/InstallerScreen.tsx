import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

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

/** Shared chrome for every installer step: title, body, back and continue. */
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
  return (
    <div className="mx-auto flex min-h-full w-full max-w-xl flex-col px-6 py-10">
      <div className="mb-6 flex h-8 items-center">
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground">
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>
        )}
      </div>

      <div className="flex-1">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        {description && <div className="mt-2 text-sm text-muted-foreground">{description}</div>}
        <div className="mt-6">{children}</div>
      </div>

      {(onContinue || footer) && (
        <div className="mt-8 flex items-center justify-end gap-3">
          {footer}
          {onContinue && (
            <Button onClick={onContinue} disabled={continueDisabled}>
              {continueLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
