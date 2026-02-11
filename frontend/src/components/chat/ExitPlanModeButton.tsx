import { useState, memo } from "react";
import { Button } from "@/components/ui/button";

interface ExitPlanModeButtonProps {
  isInteractive?: boolean;
  onApprove?: () => void;
}

export const ExitPlanModeButton = memo(function ExitPlanModeButton({
  isInteractive = false,
  onApprove,
}: ExitPlanModeButtonProps) {
  const [approved, setApproved] = useState(false);

  const isDisabled = !isInteractive || approved;

  const handleApprove = () => {
    setApproved(true);
    onApprove?.();
  };

  if (isDisabled) {
    return (
      <div className="my-2 rounded-lg border bg-card p-4">
        <div className="text-sm text-muted-foreground italic">
          Plan approved
        </div>
      </div>
    );
  }

  return (
    <div className="my-2 rounded-lg border bg-card p-4">
      <div className="mb-3 text-sm font-medium">
        Claude wants to exit plan mode and start implementation.
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={handleApprove}>
          Approve Plan
        </Button>
      </div>
    </div>
  );
});
