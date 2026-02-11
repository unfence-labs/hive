import type { ChatMessage as ChatMessageType, QuestionAnswer } from "@/types";
import { isAskUserQuestion, isExitPlanMode } from "@/types";
import { cn } from "@/lib/utils";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import ChatToolUse from "@/components/ChatToolUse";
import { ThinkingBlock } from "@/components/chat/ThinkingBlock";
import { AskUserQuestion } from "@/components/chat/AskUserQuestion";
import { ExitPlanModeButton } from "@/components/chat/ExitPlanModeButton";

interface ChatMessageProps {
  message: ChatMessageType;
  isInteractive?: boolean;
  onQuestionAnswer?: (toolCallId: string, answers: QuestionAnswer[]) => void;
  onPlanApproval?: () => void;
}

export default function ChatMessage({
  message,
  isInteractive = false,
  onQuestionAnswer,
  onPlanApproval,
}: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
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
              <MarkdownRenderer content={message.content} />
            </div>
            {message.toolCalls && message.toolCalls.length > 0 && (
              <div className="mt-2">
                {message.toolCalls.map((tool) => {
                  if (isAskUserQuestion(tool)) {
                    return (
                      <AskUserQuestion
                        key={tool.id}
                        tool={tool}
                        isInteractive={isInteractive}
                        onAnswer={onQuestionAnswer}
                      />
                    );
                  }
                  if (isExitPlanMode(tool)) {
                    return (
                      <ExitPlanModeButton
                        key={tool.id}
                        toolCallId={tool.id}
                        isInteractive={isInteractive}
                        onApprove={onPlanApproval}
                      />
                    );
                  }
                  return <ChatToolUse key={tool.id} tool={tool} />;
                })}
              </div>
            )}
            {message.cancelled && (
              <div className="mt-2 text-xs italic text-muted-foreground">
                (cancelled)
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
