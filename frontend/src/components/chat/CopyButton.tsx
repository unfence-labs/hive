import { memo } from "react";
import { ClipboardIcon, CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useClipboardCopy } from "@/hooks/useClipboardCopy";

interface CopyButtonProps {
  content: string;
  className?: string;
}

export const CopyButton = memo(function CopyButton({
  content,
  className,
}: CopyButtonProps) {
  const { copy, isCopied } = useClipboardCopy();
  const copied = isCopied(content);

  const handleCopy = async () => {
    await copy(content);
  };

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={handleCopy}
      className={cn(
        "transition-opacity",
        className,
      )}
      aria-label={copied ? "Copied" : "Copy message"}
    >
      {copied ? (
        <CheckIcon className="size-3 text-green-500" />
      ) : (
        <ClipboardIcon className="size-3" />
      )}
    </Button>
  );
});
