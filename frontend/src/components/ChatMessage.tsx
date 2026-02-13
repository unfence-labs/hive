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
            ? "rounded-lg bg-primary/10 px-3 py-2 text-primary ring-1 ring-primary/15"
            : "text-foreground",
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <>
            {message.thinkingContent && (
              <ThinkingBlock content={message.thinkingContent} />
            )}
            <div className="prose-sm">
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
              <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
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
