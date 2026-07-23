import { memo, useEffect, useState, type ReactNode } from "react";
import type { ChatMessage as ChatMessageType, FileMention, QuestionAnswer } from "@/types";
import { cn } from "@/lib/utils";
import { formatElapsed } from "@/lib/time";
import { resolveImageSrc } from "@/lib/image-url";
import { MessageResponse } from "@/components/ai-elements/message";
import { ThinkingBlock } from "@/components/chat/ThinkingBlock";
import { AgentActivityList, getInlineAgentActivities } from "@/components/chat/AgentActivityList";
import { CopyButton } from "@/components/chat/CopyButton";
import { ImageLightbox } from "@/components/chat/ImageLightbox";
import { FileIcon, RotateCwIcon, TargetIcon } from "lucide-react";
import type { PlanStatus } from "@/components/chat/PlanProposal";
import type { SendState } from "@/lib/optimistic-sends";
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

/**
 * Grace delay before showing "Sending…" under an optimistic user message.
 * A healthy echo confirms in well under this, so the label only appears for
 * genuinely slow/unconfirmed sends instead of flashing on every message.
 */
export const SENDING_INDICATOR_DELAY_MS = 2_000;

/** True only when `sendState` has been "sending" for the grace delay. */
function useShowSendingIndicator(sendState: SendState | undefined): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (sendState !== "sending") {
      setShow(false);
      return;
    }
    const timer = setTimeout(() => setShow(true), SENDING_INDICATOR_DELAY_MS);
    return () => clearTimeout(timer);
  }, [sendState]);
  return show;
}

interface ChatMessageProps {
  message: ChatMessageType;
  isInteractive?: boolean;
  planStatus?: PlanStatus;
  dismissedToolCallIds?: Set<string>;
  onQuestionAnswer?: (toolCallId: string, answers: QuestionAnswer[]) => void;
  onFileMentionClick?: (relativePath: string) => void;
  /** Delivery state when this is an optimistically-appended user message. */
  sendState?: SendState;
  onRetrySend?: (messageId: string) => void;
}

const ChatMessage = memo(function ChatMessage({
  message,
  isInteractive = false,
  planStatus,
  dismissedToolCallIds,
  onQuestionAnswer,
  onFileMentionClick,
  sendState,
  onRetrySend,
}: ChatMessageProps) {
  const isUser = message.role === "user";
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const showSendingIndicator = useShowSendingIndicator(sendState);
  const hasDeliveryIssue = sendState === "failed" || sendState === "unconfirmed";
  const inlineAgentActivities = getInlineAgentActivities(message.agentActivities ?? []);
  const showAssistantActions = !isUser && (message.durationMs != null || Boolean(message.content));

  if (!isUser) {
    const hasAssistantContent = Boolean(
      message.content ||
      message.reasoningSegments?.length ||
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
          {message.goalCommand && (
            <div className="mt-1 flex justify-end">
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/15 bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm">
                <TargetIcon className="size-3" />
                Sent with goal
              </span>
            </div>
          )}
          {sendState === "sending" && showSendingIndicator && (
            <span className="mt-1 text-[10px] text-muted-foreground" data-testid="send-state-sending">
              Sending…
            </span>
          )}
          {hasDeliveryIssue && (
            <div
              className="mt-1 flex items-center gap-2 text-[10px] font-medium"
              data-testid={`send-state-${sendState}`}
            >
              <span className={sendState === "failed" ? "text-destructive" : "text-muted-foreground"}>
                {sendState === "failed" ? "Not delivered" : "Delivery unconfirmed"}
              </span>
              {sendState === "failed" && onRetrySend && (
                <button
                  type="button"
                  onClick={() => onRetrySend(message.id)}
                  className="inline-flex items-center gap-1 text-destructive hover:underline"
                >
                  <RotateCwIcon className="size-3" />
                  Retry
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="max-w-[85%] text-sm leading-relaxed text-foreground">
          <ThinkingBlock segments={message.reasoningSegments} />
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
