import { memo, useState, type ReactNode } from "react";
import type { ChatMessage as ChatMessageType, FileMention, QuestionAnswer } from "@/types";
import { cn } from "@/lib/utils";
import { formatElapsed } from "@/lib/time";
import { resolveImageSrc } from "@/lib/image-url";
import { MessageResponse } from "@/components/ai-elements/message";
import { ThinkingBlock } from "@/components/chat/ThinkingBlock";
import { AgentActivityList, getInlineAgentActivities } from "@/components/chat/AgentActivityList";
import { CopyButton } from "@/components/chat/CopyButton";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FileIcon, TargetIcon } from "lucide-react";
import type { PlanStatus } from "@/components/chat/PlanProposal";
import { AT_MENTION_RE, splitByAllMentions } from "@/lib/file-mentions";

function renderContentWithMentions(
  content: string,
  mentions: FileMention[] | undefined,
  onFileClick?: (relativePath: string) => void,
): ReactNode {
  const atMatches = content.match(AT_MENTION_RE);
  const atMentions = atMatches ? [...new Set(atMatches)] : [];

  if (!mentions?.length && atMentions.length === 0) return <p className="whitespace-pre-wrap">{content}</p>;

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

  return <p className="whitespace-pre-wrap">{segments}</p>;
}

interface ChatMessageProps {
  message: ChatMessageType;
  isInteractive?: boolean;
  planStatus?: PlanStatus;
  dismissedToolCallIds?: Set<string>;
  onQuestionAnswer?: (toolCallId: string, answers: QuestionAnswer[]) => void;
  onFileMentionClick?: (relativePath: string) => void;
}

const ChatMessage = memo(function ChatMessage({
  message,
  isInteractive = false,
  planStatus,
  dismissedToolCallIds,
  onQuestionAnswer,
  onFileMentionClick,
}: ChatMessageProps) {
  const isUser = message.role === "user";
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const inlineAgentActivities = getInlineAgentActivities(message.agentActivities ?? []);

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
      <div
        className={cn(
          "max-w-[85%] text-sm leading-relaxed",
          isUser
            ? "group/user-msg relative rounded-[10px] rounded-br-[2px] border border-primary/25 bg-primary/10 px-3.5 py-2 text-foreground dark:border-primary/15 dark:bg-primary/20 dark:text-white"
            : "text-foreground",
        )}
      >
        {isUser ? (
          <>
            {message.content && (
              <CopyButton
                content={message.content}
                className="absolute -top-2 -right-2 opacity-0 transition-opacity group-hover/user-msg:opacity-100"
              />
            )}
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
                <Dialog
                  open={lightboxIndex !== null}
                  onOpenChange={(open) => { if (!open) setLightboxIndex(null); }}
                >
                  <DialogContent
                    showCloseButton={false}
                    overlayClassName="bg-black/80 backdrop-blur-sm"
                    className="flex items-center justify-center border-none bg-transparent p-0 shadow-none sm:max-w-[90vw]"
                    onClick={() => setLightboxIndex(null)}
                  >
                    <DialogTitle className="sr-only">Image preview</DialogTitle>
                    <DialogDescription className="sr-only">Full size image preview</DialogDescription>
                    {lightboxIndex !== null && message.images[lightboxIndex] && (
                      <img
                        src={resolveImageSrc(message.images[lightboxIndex].dataUrl)}
                        alt={message.images[lightboxIndex].name}
                        className="mx-auto max-h-[85vh] w-auto rounded-lg object-contain"
                      />
                    )}
                  </DialogContent>
                </Dialog>
              </>
            )}
            {message.content && renderContentWithMentions(message.content, message.fileMentions, onFileMentionClick)}
            {message.goalCommand && (
              <div className="mt-1.5 flex justify-end">
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/15 bg-primary/5 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  <TargetIcon className="size-3" />
                  Sent with goal
                </span>
              </div>
            )}
          </>
        ) : (
          <>
            {message.thinkingContent && (
              <ThinkingBlock content={message.thinkingContent} />
            )}
            {message.content && (
              <div className="prose-sm">
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
            {message.durationMs != null && (
              <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span>{formatElapsed(message.durationMs)}</span>
                <span>·</span>
                <CopyButton content={message.content} className="mb-0.5" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
});

export default ChatMessage;
