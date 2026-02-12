import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import ChatMessage from "@/components/ChatMessage";
import { MessageResponse } from "@/components/ai-elements/message";
import { ThinkingBlock } from "@/components/chat/ThinkingBlock";
import { ToolCallList } from "@/components/chat/ToolCallList";
import type { ChatMessage as ChatMessageType, ToolCall, QuestionAnswer } from "@/types";
import type { PendingToolInput } from "@/hooks/useConversation";

interface ChatConversationProps {
  messages: ChatMessageType[];
  isStreaming: boolean;
  currentStreamingText: string;
  currentThinking: string;
  activeToolCalls: ToolCall[];
  pendingToolInputs?: PendingToolInput[];
  onQuestionAnswer?: (toolCallId: string, answers: QuestionAnswer[]) => void;
  onPlanApproval?: () => void;
  onRejectToolInput?: (message?: string) => void;
}

export default function ChatConversation({
  messages,
  isStreaming,
  currentStreamingText,
  currentThinking,
  activeToolCalls,
  pendingToolInputs = [],
  onQuestionAnswer,
  onPlanApproval,
  onRejectToolInput,
}: ChatConversationProps) {
  const hasContent = messages.length > 0 || isStreaming;

  // A message is interactive if it contains tool calls that match pending tool inputs.
  // Fallback to the old heuristic (last assistant message, no user after) when no pending inputs.
  const hasPendingInputs = pendingToolInputs.length > 0;
  const pendingToolUseIds = new Set(pendingToolInputs.map((p) => p.toolUseId));

  const lastAssistantIdx = isStreaming
    ? -1
    : messages.reduce((acc, msg, i) => (msg.role === "assistant" ? i : acc), -1);
  const hasUserAfterLast =
    lastAssistantIdx >= 0 &&
    messages.slice(lastAssistantIdx + 1).some((m) => m.role === "user");

  const isMessageInteractive = (msg: ChatMessageType, idx: number): boolean => {
    if (hasPendingInputs) {
      return msg.toolCalls?.some((tc) => pendingToolUseIds.has(tc.id)) ?? false;
    }
    return idx === lastAssistantIdx && !hasUserAfterLast;
  };

  return (
    <Conversation className="flex-1">
      <ConversationContent className="gap-4 p-4">
        {!hasContent && (
          <ConversationEmptyState
            className="py-20 text-sm text-muted-foreground"
            title="Send a message to start a conversation."
            description=""
          />
        )}
        {messages.map((msg, i) => (
          <ChatMessage
            key={msg.id ?? `${msg.timestamp}-${i}`}
            message={msg}
            isInteractive={isMessageInteractive(msg, i)}
            onQuestionAnswer={onQuestionAnswer}
            onPlanApproval={onPlanApproval}
            onRejectToolInput={onRejectToolInput}
          />
        ))}

        {/* Live streaming content */}
        {isStreaming && (currentStreamingText || currentThinking || activeToolCalls.length > 0) && (
          <div className="flex w-full justify-start">
            <div className="max-w-[85%] text-sm leading-relaxed text-foreground">
              {currentThinking && (
                <ThinkingBlock content={currentThinking} defaultOpen streaming />
              )}
              {currentStreamingText && (
                <div className="prose-sm">
                  <MessageResponse isAnimating>{currentStreamingText}</MessageResponse>
                </div>
              )}
              <ToolCallList
                toolCalls={activeToolCalls}
                isInteractive
                showExecutingState
                onQuestionAnswer={onQuestionAnswer}
                onPlanApproval={onPlanApproval}
                onRejectToolInput={onRejectToolInput}
              />
            </div>
          </div>
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
