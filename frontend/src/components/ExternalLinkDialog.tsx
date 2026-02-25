import { useCallback, useState } from "react";
import { Copy, Check, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { copyToClipboard } from "@/lib/clipboard";

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
      await copyToClipboard(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard fallback also failed
    }
  }, [url]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Open external link?</DialogTitle>
          <DialogDescription>
            You're about to visit an external website.
          </DialogDescription>
        </DialogHeader>
        <div className="break-all rounded-md bg-muted p-3 font-mono text-sm">
          {url}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCopy}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          <DialogClose asChild>
            <Button onClick={onConfirm}>
              <ExternalLink className="size-3.5" />
              Open link
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
