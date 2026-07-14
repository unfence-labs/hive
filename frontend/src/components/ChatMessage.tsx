import { memo, useState, type ReactNode } from "react";
import type { ChatMessage as ChatMessageType, FileMention, QuestionAnswer, UiAnnotation } from "@/types";
import { cn } from "@/lib/utils";
import { formatElapsed } from "@/lib/time";
import { resolveImageSrc } from "@/lib/image-url";
import { MessageResponse } from "@/components/ai-elements/message";
import { ThinkingBlock } from "@/components/chat/ThinkingBlock";
import { AgentActivityList, getInlineAgentActivities } from "@/components/chat/AgentActivityList";
import { CopyButton } from "@/components/chat/CopyButton";
import { ImageLightbox } from "@/components/chat/ImageLightbox";
import { ChevronDownIcon, CrosshairIcon, FileIcon, PencilLineIcon, TargetIcon } from "lucide-react";
import type { PlanStatus } from "@/components/chat/PlanProposal";
import { AT_MENTION_RE, splitByAllMentions } from "@/lib/file-mentions";

function renderContentWithMentions(
  content: string,
  mentions: FileMention[] | undefined,
  onFileClick?: (relativePath: string) => void,
): ReactNode {
  const atMatches = content.match(AT_MENTION_RE);
  const atMentions = atMatches ? [...new Set(atMatches)] : [];

  if (!mentions?.length && atMentions.length === 0)
    return <p className="whitespace-pre-wrap wrap-anywhere" data-find-content="">{content}</p>;

  const segments = splitByAllMentions(content, mentions, atMentions).map((segment, i) => {
    if (segment.mention) {
      return (
        <button
          key={i}
          type="button"
          onClick={() => onFileClick?.(segment.mention!.relativePath)}
          className="inline-flex items-center gap-0.5 rounded bg-primary/15 px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-primary/25 transition-colors"
        >
          <FileIcon className="size-3" />
          {segment.mention!.displayName}
        </button>
      );
    }
    if (segment.highlight) {
      return (
        <span
          key={i}
          className="rounded bg-primary/15 px-1 py-0.5 text-xs font-medium text-primary"
        >
          {segment.text}
        </span>
      );
    }
    return <span key={i}>{segment.text}</span>;
  });

  return <p className="whitespace-pre-wrap wrap-anywhere" data-find-content="">{segments}</p>;
}

interface ChatMessageProps {
  message: ChatMessageType;
  isInteractive?: boolean;
  planStatus?: PlanStatus;
  dismissedToolCallIds?: Set<string>;
  onQuestionAnswer?: (toolCallId: string, answers: QuestionAnswer[]) => void;
  onFileMentionClick?: (relativePath: string) => void;
  /** Opens the preview and flashes the annotation's location on its page. */
  onLocateAnnotation?: (annotation: UiAnnotation) => void;
}

const ChatMessage = memo(function ChatMessage({
  message,
  isInteractive = false,
  planStatus,
  dismissedToolCallIds,
  onQuestionAnswer,
  onFileMentionClick,
  onLocateAnnotation,
}: ChatMessageProps) {
  const isUser = message.role === "user";
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [annotationsExpanded, setAnnotationsExpanded] = useState(false);
  const inlineAgentActivities = getInlineAgentActivities(message.agentActivities ?? []);
  const showAssistantActions = !isUser && (message.durationMs != null || Boolean(message.content));

  if (!isUser) {
    const hasAssistantContent = Boolean(
      message.content ||
      message.thinkingContent ||
      message.toolCalls?.length ||
      inlineAgentActivities.length ||
      message.cancelled,
    );
    if (!hasAssistantContent) return null;
  }

  return (
    <div className={cn("flex w-full items-start", isUser ? "justify-end" : "justify-start")}>
      {isUser ? (
        <div className="flex max-w-[85%] flex-col items-end text-sm leading-relaxed">
          {message.images && message.images.length > 0 && (
            <>
              <div className={cn("flex flex-wrap justify-end gap-1.5", message.content && "mb-1.5")}>
                {message.images.map((img, i) => (
                  <button
                    key={`${message.id}-img-${i}`}
                    type="button"
                    onClick={() => setLightboxIndex(i)}
                    className="h-10 w-14 flex-none cursor-pointer overflow-hidden rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <img
                      src={resolveImageSrc(img.dataUrl)}
                      alt={img.name}
                      className="h-full w-full object-cover"
                    />
                  </button>
                ))}
              </div>
              {lightboxIndex !== null && message.images[lightboxIndex] && (
                <ImageLightbox
                  src={resolveImageSrc(message.images[lightboxIndex].dataUrl)}
                  alt={message.images[lightboxIndex].name}
                  open
                  onClose={() => setLightboxIndex(null)}
                />
              )}
            </>
          )}
          {message.content && (
            <div className="group/user-msg relative rounded-[10px] rounded-br-[2px] border border-primary/25 bg-primary/10 px-3.5 py-2 text-foreground dark:border-primary/15 dark:bg-primary/20">
              <CopyButton
                content={message.content}
                className="absolute -top-2 -right-2 opacity-0 transition-opacity group-hover/user-msg:opacity-100"
              />
              {renderContentWithMentions(message.content, message.fileMentions, onFileMentionClick)}
            </div>
          )}
          {message.annotations && message.annotations.length > 0 && (
            <div className="mt-1 flex w-full flex-col items-end gap-1">
              <button
                type="button"
                onClick={() => setAnnotationsExpanded((v) => !v)}
                className="inline-flex items-center gap-1 rounded-full border border-primary/15 bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm transition-colors hover:text-foreground"
              >
                <PencilLineIcon className="size-3" />
                {message.annotations.length === 1
                  ? "1 UI annotation"
                  : `${message.annotations.length} UI annotations`}
                <ChevronDownIcon
                  className={cn("size-3 transition-transform", annotationsExpanded && "rotate-180")}
                />
              </button>
              {annotationsExpanded && (
                <div className="w-full rounded-md border border-border/40 bg-background p-2 text-left shadow-sm">
                  {message.annotations.map((a) => (
                    <div key={a.id} className="flex items-start gap-2 border-b border-border/30 py-1 last:border-b-0">
                      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                        {a.id}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-foreground">{a.note || "(no note)"}</p>
                        <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                          {a.selector ?? `area ${Math.round(a.rect.w)}×${Math.round(a.rect.h)}`}
                          {a.component ? ` · <${a.component}>` : ""}
                        </p>
                      </div>
                      {onLocateAnnotation && (
                        <button
                          type="button"
                          title="Show in preview"
                          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-primary"
                          onClick={() => onLocateAnnotation(a)}
                        >
                          <CrosshairIcon className="size-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {message.goalCommand && (
            <div className="mt-1 flex justify-end">
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/15 bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm">
                <TargetIcon className="size-3" />
                Sent with goal
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="max-w-[85%] text-sm leading-relaxed text-foreground">
          {message.thinkingContent && (
            <ThinkingBlock content={message.thinkingContent} />
          )}
          {message.content && (
            <div className="prose-sm" data-find-content="">
              <MessageResponse>{message.content}</MessageResponse>
            </div>
          )}
          {Boolean(inlineAgentActivities.length || message.toolCalls?.length) && (
            <AgentActivityList
              activities={inlineAgentActivities}
              toolCalls={message.toolCalls}
              isInteractive={isInteractive}
              planStatus={planStatus}
              dismissedToolCallIds={dismissedToolCallIds}
              onQuestionAnswer={onQuestionAnswer}
            />
          )}
          {message.cancelled && (
            <div className="mt-2 space-y-1 text-xs">
              <div className="italic text-muted-foreground">(cancelled)</div>
              {message.errorDetail && (
                <div className="break-words font-mono text-[11px] text-destructive/90">
                  {message.errorDetail}
                </div>
              )}
            </div>
          )}
          {showAssistantActions && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              {message.durationMs != null && <span>{formatElapsed(message.durationMs)}</span>}
              {message.durationMs != null && message.content && <span>·</span>}
              {message.content && <CopyButton content={message.content} className="mb-0.5" />}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default ChatMessage;
