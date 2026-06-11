import { type ReactNode } from "react";
import { ImageIcon } from "lucide-react";
import type { AgentActivity } from "@/types";
import { resolveImageSrc } from "@/lib/image-url";
import { ActivityShell, ActivityDetailChip } from "@/components/chat/ActivityShell";
import { ImageTileWithLightbox } from "@/components/chat/ImageTile";

const OUTSIDE_WORKSPACE_MESSAGE = "Image is outside the workspace and cannot be previewed.";

function fileName(path: string): string {
  return path.split("/").pop() || path;
}

function promptPreview(prompt: string | undefined): string | undefined {
  const normalized = prompt?.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length > 64 ? `${normalized.slice(0, 64)}...` : normalized;
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

function ImageActivityShell({
  title,
  detail,
  expandedContent,
  src,
  alt,
  pending,
  noPreviewMessage,
}: {
  title: string;
  detail?: ReactNode;
  expandedContent?: ReactNode;
  src?: string;
  alt: string;
  pending?: boolean;
  noPreviewMessage?: string;
}) {
  return (
    <ActivityShell
      title={title}
      icon={<ImageIcon className="size-3.5" />}
      detail={detail}
      executing={pending}
      expandedContent={expandedContent}
      belowContent={
        <ImageTileWithLightbox
          src={src}
          alt={alt}
          pending={pending}
          noPreviewMessage={noPreviewMessage}
          className="mt-2 size-20 max-w-full"
        />
      }
    />
  );
}

export function ImageViewActivity({ activity }: { activity: Extract<AgentActivity, { kind: "image_view" }> }) {
  const name = fileName(activity.path);
  const src = resolveImageViewSrc(activity);
  const expandedContent = activity.outsideWorkspace
    ? OUTSIDE_WORKSPACE_MESSAGE
    : src
      ? undefined
      : activity.path;

  return (
    <ImageActivityShell
      title="View image"
      detail={<ActivityDetailChip text={name} />}
      src={src}
      alt={name}
      noPreviewMessage={activity.outsideWorkspace ? OUTSIDE_WORKSPACE_MESSAGE : undefined}
      expandedContent={expandedContent}
    />
  );
}

export function ImageGenerationActivity({
  activity,
  showExecutingState,
}: {
  activity: Extract<AgentActivity, { kind: "image_generation" }>;
  showExecutingState?: boolean;
}) {
  const pending = isGenerationPending(activity, showExecutingState);
  const src = imageGenerationSrc(activity);
  const alt = activity.revisedPrompt ?? "Generated image";
  const promptDetail = promptPreview(activity.revisedPrompt);
  const detail = promptDetail ? <ActivityDetailChip text={promptDetail} /> : undefined;

  return (
    <ImageActivityShell
      title="Proposed image"
      detail={detail}
      src={src}
      alt={alt}
      pending={pending}
      expandedContent={
        activity.revisedPrompt
          ? <p className="whitespace-pre-wrap text-muted-foreground">{activity.revisedPrompt}</p>
          : undefined
      }
    />
  );
}
