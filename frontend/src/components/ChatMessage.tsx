import { memo } from "react";
import type { ChatMessage as ChatMessageType, QuestionAnswer } from "@/types";
import { cn } from "@/lib/utils";
import { formatElapsed } from "@/lib/time";
import { resolveImageSrc } from "@/lib/image-url";
import { MessageResponse } from "@/components/ai-elements/message";
import { ThinkingBlock } from "@/components/chat/ThinkingBlock";
import { ToolCallList } from "@/components/chat/ToolCallList";
import { CopyButton } from "@/components/chat/CopyButton";
import type { PlanStatus } from "@/components/chat/PlanProposal";

interface ChatMessageProps {
  message: ChatMessageType;
  isInteractive?: boolean;
  planStatus?: PlanStatus;
  onQuestionAnswer?: (toolCallId: string, answers: QuestionAnswer[]) => void;
  onPlanApproval?: () => void;
  onHandOff?: (planContent: string, planPath?: string) => void;
}

const ChatMessage = memo(function ChatMessage({
  message,
  isInteractive = false,
  planStatus,
  onQuestionAnswer,
  onPlanApproval,
  onHandOff,
}: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex w-full items-start", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] text-sm leading-relaxed",
          isUser
            ? "group/user-msg relative rounded-[10px] rounded-br-[2px] border border-primary/15 bg-primary/20 px-3.5 py-2 text-white"
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
                    src={resolveImageSrc(img.dataUrl)}
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
            <div className="prose-sm">
              <MessageResponse>{message.content}</MessageResponse>
            </div>
            {message.toolCalls && (
              <ToolCallList
                toolCalls={message.toolCalls}
                isInteractive={isInteractive}
                planStatus={planStatus}
                onQuestionAnswer={onQuestionAnswer}
                onPlanApproval={onPlanApproval}
                onHandOff={onHandOff}
              />
            )}
            {message.cancelled && (
              <div className="mt-2 text-xs italic text-muted-foreground">
                (cancelled)
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
