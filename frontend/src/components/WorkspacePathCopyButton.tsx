import { CheckIcon, ClipboardIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useClipboardCopy } from "@/hooks/useClipboardCopy";

interface WorkspacePathCopyButtonProps {
  path: string;
  disabledReason: string;
}

export function WorkspacePathCopyButton({
  path,
  disabledReason,
}: WorkspacePathCopyButtonProps) {
  const { copy, isCopied } = useClipboardCopy();
  const canCopy = path.length > 0;
  const copied = canCopy && isCopied(path);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <Button
              variant="ghost"
              size="icon-xs"
              className="size-5 text-muted-foreground/70 hover:text-foreground"
              onClick={() => { if (canCopy) void copy(path); }}
              disabled={!canCopy}
              aria-label={copied ? "Workspace path copied" : "Copy workspace path"}
            >
              {copied ? (
                <CheckIcon className="size-3 text-green-500" />
              ) : (
                <ClipboardIcon className="size-3" />
              )}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          className={path ? "max-w-[28rem] break-all font-mono text-xs" : undefined}
        >
          {copied ? "Path copied" : path || disabledReason}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
