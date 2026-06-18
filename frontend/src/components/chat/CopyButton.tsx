import { memo } from "react";
import { ClipboardIcon, CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useClipboardCopy } from "@/hooks/useClipboardCopy";

interface CopyButtonProps {
  content: string;
  className?: string;
  ariaLabel?: string;
  copiedAriaLabel?: string;
  iconClassName?: string;
  disabled?: boolean;
}

export const CopyButton = memo(function CopyButton({
  content,
  className,
  ariaLabel = "Copy message",
  copiedAriaLabel = "Copied",
  iconClassName = "size-3",
  disabled = false,
}: CopyButtonProps) {
  const { copy, isCopied } = useClipboardCopy();
  const copied = isCopied(content);

  const handleCopy = async () => {
    if (disabled) return;
    await copy(content);
  };

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={handleCopy}
      disabled={disabled}
      className={cn(
        "transition-opacity",
        className,
      )}
      aria-label={copied ? copiedAriaLabel : ariaLabel}
    >
      {copied ? (
        <CheckIcon className={cn(iconClassName, "text-success-foreground")} />
      ) : (
        <ClipboardIcon className={iconClassName} />
      )}
    </Button>
  );
});
