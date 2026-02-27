import { useState, useEffect, memo } from "react";
import { FileTextIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { MessageResponse } from "@/components/ai-elements/message";
import { Badge } from "@/components/ui/badge";

export type PlanStatus = "interactive" | "approved" | "revised";

interface PlanProposalProps {
  planContent?: string;
  status: PlanStatus;
}

export const PlanProposal = memo(function PlanProposal({
  planContent,
  status,
}: PlanProposalProps) {
  const [open, setOpen] = useState(status === "interactive");

  // Auto-collapse when status transitions to "revised" (new refinement arrived)
  useEffect(() => {
    if (status === "revised") setOpen(false);
  }, [status]);

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
    <div className="my-0.5">
      <button
        type="button"
        className={cn(
          "inline-flex w-fit max-w-full items-center gap-2 rounded-md py-1 pr-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground",
        )}
        onClick={() => planContent && setOpen(!open)}
      >
        <span className="shrink-0">
          <FileTextIcon className="size-3.5" />
        </span>
        <span>Proposed plan</span>
        {statusBadge}
      </button>
      {open && planContent && (
        <div className="mt-1 [&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg">
          <MessageResponse>{planContent}</MessageResponse>
        </div>
      )}
    </div>
  );
});
