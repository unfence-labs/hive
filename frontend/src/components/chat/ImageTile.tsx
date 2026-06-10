import { ImageOffIcon } from "lucide-react";
import { useState } from "react";
import { useImageLoadStatus } from "@/hooks/useImageLoadStatus";
import { cn } from "@/lib/utils";
import { ImageLightbox } from "@/components/chat/ImageLightbox";

export interface ImageTileProps {
  /** Resolved, browser-loadable src. undefined => nothing to load. */
  src?: string;
  alt: string;
  /** Force the animated "generating" placeholder regardless of src. */
  pending?: boolean;
  /** Message exposed by the "no preview" tile (e.g. outside-workspace). */
  noPreviewMessage?: string;
  /** Wired only once the image is loaded — makes the tile open a lightbox. */
  onOpenLightbox?: () => void;
  className?: string;
}

const TILE = "relative size-12 shrink-0 overflow-hidden rounded-md border border-border/60";

/**
 * Fixed-size thumbnail tile covering every image state without reflow:
 * a generating placeholder (sheen), the brief decode window, the loaded image
 * (optionally clickable to a lightbox), a load error, or a no-preview notice.
 * Mirrors the loading/loaded/error pattern of `FileViewer`'s `ImageFilePreview`.
 */
export function ImageTile({ src, alt, pending, noPreviewMessage, onOpenLightbox, className }: ImageTileProps) {
  const { status, imageRef, handleLoad, handleError } = useImageLoadStatus(src);
  const showImage = Boolean(src) && !pending && status === "loaded";
  const showError = Boolean(src) && !pending && status === "error";
  const decoding = Boolean(src) && !pending && status === "loading";
  // Animated "generating" tile only for real pending generations; a decoding
  // real image gets a plain static box so it never looks like it's generating.
  const showPlaceholder = Boolean(pending) || decoding;
  const showNoPreview = !src && !pending;

  return (
    <div className={cn(TILE, "bg-muted/40", className)}>
      {/*
        The image stays mounted and visible (never display:none) so it actually
        loads and fires onLoad — a lazy + hidden image never intersects the
        viewport and would load forever. Placeholders sit on top until loaded.
      */}
      {src && !pending && (
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          onLoad={handleLoad}
          onError={handleError}
          className="size-full object-cover"
        />
      )}
      {showPlaceholder && (
        <div
          className={cn("absolute inset-0", pending ? "animate-pulse bg-accent" : "bg-muted")}
          aria-label={pending ? "Generating image" : undefined}
        >
          {pending && (
            <span className="absolute inset-0 -translate-x-full animate-sheen bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          )}
        </div>
      )}
      {showError && (
        <div className="absolute inset-0 grid place-items-center bg-muted text-muted-foreground" title="Preview unavailable">
          <ImageOffIcon className="size-5" aria-label="Preview unavailable" />
        </div>
      )}
      {showNoPreview && (
        <div className="absolute inset-0 grid place-items-center bg-muted text-muted-foreground" title={noPreviewMessage}>
          <ImageOffIcon className="size-5" aria-hidden />
        </div>
      )}
      {showImage && onOpenLightbox && (
        <button
          type="button"
          onClick={onOpenLightbox}
          aria-label="Open image"
          className="absolute inset-0 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      )}
    </div>
  );
}

interface ImageTileWithLightboxProps extends Omit<ImageTileProps, "onOpenLightbox"> {
  src?: string;
  alt: string;
}

export function ImageTileWithLightbox({ src, alt, ...tileProps }: ImageTileWithLightboxProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);

  return (
    <>
      <ImageTile
        {...tileProps}
        src={src}
        alt={alt}
        onOpenLightbox={src ? () => setLightboxOpen(true) : undefined}
      />
      {src && <ImageLightbox src={src} alt={alt} open={lightboxOpen} onClose={() => setLightboxOpen(false)} />}
    </>
  );
}
