import { useState, memo } from "react";
import { Button } from "@/components/ui/button";

interface ExitPlanModeButtonProps {
  isInteractive?: boolean;
  onApprove?: () => void;
  onReject?: (message?: string) => void;
}

export const ExitPlanModeButton = memo(function ExitPlanModeButton({
  isInteractive = false,
  onApprove,
  onReject,
}: ExitPlanModeButtonProps) {
  const [responded, setResponded] = useState(false);

  const isDisabled = !isInteractive || responded;

  const handleApprove = () => {
    setResponded(true);
    onApprove?.();
  };

  const handleReject = () => {
    setResponded(true);
    onReject?.();
  };

  if (isDisabled) {
    return (
      <div className="my-2 rounded-lg border bg-card p-4">
        <div className="text-sm text-muted-foreground italic">
          {responded ? "Response submitted" : "Plan approved"}
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
        <Button size="sm" variant="outline" onClick={handleReject}>
          Reject
        </Button>
      </div>
    </div>
  );
});
