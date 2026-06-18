import { memo } from "react";
import { ArrowRightLeftIcon, ClipboardIcon, CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useClipboardCopy } from "@/hooks/useClipboardCopy";

interface PlanActionBarProps {
  planContent?: string;
  planPath?: string;
  onApprove: () => void;
  onHandOff: (content: string, planPath?: string) => void;
}

export const PlanActionBar = memo(function PlanActionBar({
  planContent,
  planPath,
  onApprove,
  onHandOff,
}: PlanActionBarProps) {
  const { copy, isCopied } = useClipboardCopy();
  const copied = planContent ? isCopied(planContent) : false;

  const handleCopy = async () => {
    if (!planContent) return;
    await copy(planContent);
  };

  return (
    <div className="absolute right-4 top-0 z-10 flex -translate-y-full items-center gap-1 pb-1">
      {planContent && (
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {copied ? <CheckIcon className="size-3 text-success-foreground" /> : <ClipboardIcon className="size-3" />}
          Copy
        </button>
      )}
      <button
        type="button"
        onClick={() => onHandOff(planContent ?? "", planPath)}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowRightLeftIcon className="size-3" />
        Hand off
      </button>
      <Button size="sm" onClick={onApprove}>
        Approve
      </Button>
    </div>
  );
});
