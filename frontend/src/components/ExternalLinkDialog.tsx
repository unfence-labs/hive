import { useCallback, useState } from "react";
import { Copy, Check, ExternalLink } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ExternalLinkDialogProps {
  url: string;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ExternalLinkDialog({ url, open, onClose, onConfirm }: ExternalLinkDialogProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API unavailable
    }
  }, [url]);

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Open external link?</AlertDialogTitle>
          <AlertDialogDescription>
            You're about to visit an external website.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="break-all rounded-md bg-muted p-3 font-mono text-sm">
          {url}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCopy}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy link"}
          </AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            <ExternalLink className="size-3.5" />
            Open link
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
