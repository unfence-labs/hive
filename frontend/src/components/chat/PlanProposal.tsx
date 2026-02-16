import { useState, memo } from "react";
import { FileTextIcon, ChevronDownIcon, ArrowRightLeftIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { MessageResponse } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/chat/CopyButton";

export type PlanStatus = "interactive" | "approved" | "revised";

interface PlanProposalProps {
  planContent?: string;
  status: PlanStatus;
  onApprove?: () => void;
  onHandOff?: (content: string) => void;
}

export const PlanProposal = memo(function PlanProposal({
  planContent,
  status,
  onApprove,
  onHandOff,
}: PlanProposalProps) {
  const [open, setOpen] = useState(status === "interactive");
  const [responded, setResponded] = useState(false);

  if (!planContent) return null;

  const handleApprove = () => {
    setResponded(true);
    onApprove?.();
  };

  const handleHandOff = () => {
    setResponded(true);
    onHandOff?.(planContent);
  };

  const statusBadge =
    status === "approved" ? (
      <Badge variant="outline" className="text-[10px]">
        Approved
      </Badge>
    ) : status === "revised" ? (
      <Badge variant="outline" className="text-[10px] text-muted-foreground">
        Revised
      </Badge>
    ) : null;

  return (
    <div className="my-2 rounded-lg border bg-card">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-muted/50"
        onClick={() => setOpen(!open)}
      >
        <FileTextIcon className="size-4 text-muted-foreground" />
        <span>Proposed plan</span>
        {statusBadge}
        <ChevronDownIcon
          className={cn(
            "ml-auto size-4 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="border-t px-4 py-3 text-sm">
          <MessageResponse>{planContent}</MessageResponse>
        </div>
      )}

      {status === "interactive" && !responded && (
        <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
          <CopyButton content={planContent} />
          <Button size="sm" variant="outline" onClick={handleHandOff}>
            <ArrowRightLeftIcon className="size-3" />
            Hand off
          </Button>
          <Button size="sm" onClick={handleApprove}>
            Accept
          </Button>
        </div>
      )}

      {status === "interactive" && responded && (
        <div className="border-t px-4 py-3 text-sm italic text-muted-foreground">
          Response submitted
        </div>
      )}
    </div>
  );
});
