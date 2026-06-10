import { useState } from "react";
import type { AgentActivity } from "@/types";
import { resolveImageSrc } from "@/lib/image-url";
import { ActivityShell, ActivityDetailChip } from "@/components/chat/ActivityShell";
import { ImageTile } from "@/components/chat/ImageTile";
import { ImageLightbox } from "@/components/chat/ImageLightbox";

const OUTSIDE_WORKSPACE_MESSAGE = "Image is outside the workspace and cannot be previewed.";

function fileName(path: string): string {
  return path.split("/").pop() || path;
}

/** Resolved browser src for a viewed image, or undefined when there's no preview. */
function resolveImageViewSrc(activity: Extract<AgentActivity, { kind: "image_view" }>): string | undefined {
  return activity.imageUrl ? resolveImageSrc(activity.imageUrl) : undefined;
}

/**
 * Resolved browser src for a generated image: prefer the workspace raw-file URL,
 * fall back to the inline base64 result for generations never saved to disk.
 */
function imageGenerationSrc(activity: Extract<AgentActivity, { kind: "image_generation" }>): string | undefined {
  if (activity.imageUrl) return resolveImageSrc(activity.imageUrl);
  if (!activity.result) return undefined;
  return activity.result.startsWith("data:") ? activity.result : `data:image/png;base64,${activity.result}`;
}

/**
 * A generation is pending while a turn is live (showExecutingState) and the
 * status is non-terminal and no image is resolvable yet. History renders
 * (no showExecutingState) never animate a stale in-progress record.
 */
function isGenerationPending(
  activity: Extract<AgentActivity, { kind: "image_generation" }>,
  showExecutingState: boolean | undefined,
): boolean {
  if (imageGenerationSrc(activity)) return false;
  const status = activity.status?.toLowerCase();
  const terminal = status === "completed" || status === "failed" || status === "error";
  return Boolean(showExecutingState) && !terminal;
}

export function ImageViewActivity({ activity }: { activity: Extract<AgentActivity, { kind: "image_view" }> }) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const name = fileName(activity.path);
  const src = resolveImageViewSrc(activity);
  const expandedContent = activity.outsideWorkspace
    ? OUTSIDE_WORKSPACE_MESSAGE
    : src
      ? undefined
      : activity.path;

  return (
    <>
      <ActivityShell
        title="View image"
        detail={<ActivityDetailChip text={name} />}
        leading={
          <ImageTile
            src={src}
            alt={name}
            noPreviewMessage={activity.outsideWorkspace ? OUTSIDE_WORKSPACE_MESSAGE : undefined}
            onOpenLightbox={src ? () => setLightboxOpen(true) : undefined}
          />
        }
        expandedContent={expandedContent}
      />
      {src && <ImageLightbox src={src} alt={name} open={lightboxOpen} onClose={() => setLightboxOpen(false)} />}
    </>
  );
}

export function ImageGenerationActivity({
  activity,
  showExecutingState,
}: {
  activity: Extract<AgentActivity, { kind: "image_generation" }>;
  showExecutingState?: boolean;
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const pending = isGenerationPending(activity, showExecutingState);
  const src = imageGenerationSrc(activity);
  const alt = activity.revisedPrompt ?? "Generated image";
  const detail = pending
    ? <span className="text-muted-foreground/70">generating…</span>
    : activity.savedPath
      ? <ActivityDetailChip text="Generated image" />
      : undefined;

  return (
    <>
      <ActivityShell
        title="Generate image"
        detail={detail}
        leading={
          <ImageTile
            src={src}
            alt={alt}
            pending={pending}
            onOpenLightbox={src ? () => setLightboxOpen(true) : undefined}
          />
        }
        expandedContent={
          activity.revisedPrompt
            ? <p className="whitespace-pre-wrap text-muted-foreground">{activity.revisedPrompt}</p>
            : undefined
        }
      />
      {src && <ImageLightbox src={src} alt={alt} open={lightboxOpen} onClose={() => setLightboxOpen(false)} />}
    </>
  );
}
