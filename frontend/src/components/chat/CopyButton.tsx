import { memo, useState } from "react";
import { ClipboardIcon, CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CopyButtonProps {
  content: string;
  className?: string;
}

export const CopyButton = memo(function CopyButton({
  content,
  className,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
