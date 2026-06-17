import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

interface ImageLightboxProps {
  src: string;
  alt: string;
  open: boolean;
  onClose: () => void;
}

/**
 * Full-screen single-image lightbox. Clicking the backdrop or the image closes
 * it. Shared by chat message attachments and Codex image activities.
 */
export function ImageLightbox({ src, alt, open, onClose }: ImageLightboxProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-overlay backdrop-blur-sm"
        className="flex items-center justify-center border-none bg-transparent p-0 shadow-none sm:max-w-[90vw]"
        onClick={onClose}
      >
        <DialogTitle className="sr-only">Image preview</DialogTitle>
        <DialogDescription className="sr-only">Full size image preview</DialogDescription>
        <img
          src={src}
          alt={alt}
          className="mx-auto max-h-[85vh] w-auto rounded-lg object-contain"
        />
      </DialogContent>
    </Dialog>
  );
}
