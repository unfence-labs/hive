import { memo } from "react";
import type { ChatMessage as ChatMessageType, QuestionAnswer } from "@/types";
import { cn } from "@/lib/utils";
import { formatElapsed } from "@/lib/time";
import { MessageResponse } from "@/components/ai-elements/message";
import { ThinkingBlock } from "@/components/chat/ThinkingBlock";
import { ToolCallList } from "@/components/chat/ToolCallList";
import { CopyButton } from "@/components/chat/CopyButton";

interface ChatMessageProps {
  message: ChatMessageType;
  isInteractive?: boolean;
  onQuestionAnswer?: (toolCallId: string, answers: QuestionAnswer[]) => void;
  onPlanApproval?: () => void;
  onRejectToolInput?: (message?: string) => void;
}

const ChatMessage = memo(function ChatMessage({
  message,
  isInteractive = false,
  onQuestionAnswer,
  onPlanApproval,
  onRejectToolInput,
}: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex w-full items-start", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] text-sm leading-relaxed",
          isUser
            ? "group/user-msg relative rounded-lg bg-primary/10 px-3 py-2 text-primary ring-1 ring-primary/15"
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
              <div className="mb-2 flex flex-wrap gap-2">
                {message.images.map((img, i) => (
                  <img
                    key={`${message.id}-img-${i}`}
                    src={img.dataUrl}
                    alt={img.name}
                    className="max-h-48 max-w-xs rounded-md border border-border/30 object-contain"
                  />
                ))}
              </div>
            )}
            {message.content && <p className="whitespace-pre-wrap">{message.content}</p>}
          </>
        ) : (
          <>
            {message.thinkingContent && (
              <ThinkingBlock content={message.thinkingContent} />
            )}
            <div className="prose-sm pl-2.5">
              <MessageResponse>{message.content}</MessageResponse>
            </div>
            {message.toolCalls && (
              <ToolCallList
                toolCalls={message.toolCalls}
                isInteractive={isInteractive}
                onQuestionAnswer={onQuestionAnswer}
                onPlanApproval={onPlanApproval}
                onRejectToolInput={onRejectToolInput}
              />
            )}
            {message.cancelled && (
              <div className="mt-2 text-xs italic text-muted-foreground">
                (cancelled)
              </div>
            )}
            {message.durationMs != null && (
              <div className="mt-2 flex items-center gap-1.5 pl-2.5 text-xs text-muted-foreground">
                <span>{formatElapsed(message.durationMs)}</span>
                <span>·</span>
                <CopyButton content={message.content} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
});

export default ChatMessage;
