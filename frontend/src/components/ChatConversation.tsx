import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import ChatMessage from "@/components/ChatMessage";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import { ThinkingBlock } from "@/components/chat/ThinkingBlock";
import { ToolCallList } from "@/components/chat/ToolCallList";
import type { ChatMessage as ChatMessageType, ToolCall, QuestionAnswer } from "@/types";

interface ChatConversationProps {
  messages: ChatMessageType[];
  isStreaming: boolean;
  currentStreamingText: string;
  currentThinking: string;
  activeToolCalls: ToolCall[];
  onQuestionAnswer?: (toolCallId: string, answers: QuestionAnswer[]) => void;
  onPlanApproval?: () => void;
}

export default function ChatConversation({
  messages,
  isStreaming,
  currentStreamingText,
  currentThinking,
  activeToolCalls,
  onQuestionAnswer,
  onPlanApproval,
}: ChatConversationProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentStreamingText, activeToolCalls]);

  const hasContent = messages.length > 0 || isStreaming;

  // Only the last assistant message (with no user message after it) is interactive.
  // If we're currently streaming, the streaming section handles interactivity instead.
  const lastAssistantIdx = isStreaming
    ? -1
    : messages.reduce((acc, msg, i) => (msg.role === "assistant" ? i : acc), -1);
  const hasUserAfterLast =
    lastAssistantIdx >= 0 &&
    messages.slice(lastAssistantIdx + 1).some((m) => m.role === "user");

  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-col gap-4 p-4">
        {!hasContent && (
          <div className="flex flex-1 items-center justify-center py-20 text-sm text-muted-foreground">
            Send a message to start a conversation.
          </div>
        )}
        {messages.map((msg, i) => (
          <ChatMessage
            key={msg.id ?? `${msg.timestamp}-${i}`}
            message={msg}
            isInteractive={i === lastAssistantIdx && !hasUserAfterLast}
            onQuestionAnswer={onQuestionAnswer}
            onPlanApproval={onPlanApproval}
          />
        ))}

        {/* Live streaming content */}
        {isStreaming && (currentStreamingText || currentThinking || activeToolCalls.length > 0) && (
          <div className="flex w-full justify-start">
            <div className="max-w-[85%] rounded-xl bg-muted px-4 py-3 text-sm leading-relaxed text-foreground">
              {currentThinking && (
                <ThinkingBlock content={currentThinking} defaultOpen streaming />
              )}
              {currentStreamingText && (
                <div className="prose-sm">
                  <MarkdownRenderer content={currentStreamingText} />
                </div>
              )}
              <ToolCallList
                toolCalls={activeToolCalls}
                isInteractive
                showExecutingState
                onQuestionAnswer={onQuestionAnswer}
                onPlanApproval={onPlanApproval}
              />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
