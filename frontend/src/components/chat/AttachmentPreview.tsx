import type { FileUIPart } from "ai";
import { XIcon, ImageIcon } from "lucide-react";

interface AttachmentPreviewProps {
  files: (FileUIPart & { id: string })[];
  onRemove: (id: string) => void;
}

export function AttachmentPreview({ files, onRemove }: AttachmentPreviewProps) {
  if (files.length === 0) return null;

  return (
    <div className="flex w-full flex-wrap gap-2 px-3 pt-2">
      {files.map((file) => (
        <div
          key={file.id}
          className="group relative flex items-center gap-2 rounded-md border border-border/50 bg-muted/50 px-2 py-1.5"
        >
          {file.url && (
            <img
              src={file.url}
              alt={file.filename ?? "attachment"}
              className="size-8 rounded object-cover"
            />
          )}
          <div className="flex flex-col">
            <span className="max-w-[120px] truncate text-xs font-medium">
              {file.filename ?? "image"}
            </span>
            <span className="flex items-center gap-1 text-[10px] uppercase text-muted-foreground">
              <ImageIcon className="size-2.5" />
              image
            </span>
          </div>
          <button
            type="button"
            className="ml-1 rounded-full p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onRemove(file.id)}
            aria-label={`Remove ${file.filename}`}
          >
            <XIcon className="size-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
