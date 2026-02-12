import { memo } from "react";
import type { ChatMessage as ChatMessageType, QuestionAnswer } from "@/types";
import { cn } from "@/lib/utils";
import { MessageResponse } from "@/components/ai-elements/message";
import { ThinkingBlock } from "@/components/chat/ThinkingBlock";
import { ToolCallList } from "@/components/chat/ToolCallList";
import { CopyButton } from "@/components/chat/CopyButton";

interface ChatMessageProps {
  message: ChatMessageType;
  isInteractive?: boolean;
  onQuestionAnswer?: (toolCallId: string, answers: QuestionAnswer[]) => void;
  onPlanApproval?: () => void;
}

const ChatMessage = memo(function ChatMessage({
  message,
  isInteractive = false,
  onQuestionAnswer,
  onPlanApproval,
}: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div className={cn("group flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "relative max-w-[85%] text-sm leading-relaxed",
          isUser ? "bg-primary text-primary-foreground" : "text-foreground",
          isUser && "rounded-xl px-4 py-3",
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
              />
            )}
            {message.cancelled && (
              <div className="mt-2 text-xs italic text-muted-foreground">
                (cancelled)
              </div>
            )}
            <CopyButton
              content={message.content}
              className="absolute right-0 top-0"
            />
          </>
        )}
      </div>
    </div>
  );
});

export default ChatMessage;
