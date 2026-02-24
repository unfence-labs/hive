import { useEffect, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import ChatMessage from "@/components/ChatMessage";
import AgentActivityPreview from "@/components/chat/AgentActivityPreview";
import { MessageResponse } from "@/components/ai-elements/message";
import { ThinkingBlock } from "@/components/chat/ThinkingBlock";
import { ToolCallList } from "@/components/chat/ToolCallList";
import { WorkspaceWelcome } from "@/components/WorkspaceWelcome";
import { formatElapsed } from "@/lib/time";
import type { ChatMessage as ChatMessageType, ToolCall, QuestionAnswer } from "@/types";
import type { PendingToolInput } from "@/hooks/useConversation";
import type { PlanStatus } from "@/components/chat/PlanProposal";

interface ChatConversationProps {
  messages: ChatMessageType[];
  isStreaming: boolean;
  streamingStartedAt?: number | null;
  currentStreamingText: string;
  currentThinking: string;
  activeToolCalls: ToolCall[];
  pendingToolInputs?: PendingToolInput[];
  onQuestionAnswer?: (toolCallId: string, answers: QuestionAnswer[]) => void;
  onPlanApproval?: () => void;
  onHandOff?: (planContent: string, planPath?: string) => void;
  workspaceName?: string;
  projectName?: string;
  branch?: string;
  defaultBranch?: string;
  fileCount?: number;
  switchCounter: number;
}

export default function ChatConversation({
  messages,
  isStreaming,
  streamingStartedAt,
  currentStreamingText,
  currentThinking,
  activeToolCalls,
  pendingToolInputs = [],
  onQuestionAnswer,
  onPlanApproval,
  onHandOff,
  workspaceName,
  projectName,
  branch,
  defaultBranch,
  fileCount,
  switchCounter,
}: ChatConversationProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isStreaming || !streamingStartedAt) {
      setElapsed(0);
      return;
    }
    setElapsed(Date.now() - streamingStartedAt);
    const id = setInterval(() => setElapsed(Date.now() - streamingStartedAt), 100);
    return () => clearInterval(id);
  }, [isStreaming, streamingStartedAt]);

  // Hide the conversation during hydration so the user never sees content
  // flash at the top before StickToBottom repositions the scroll. The sequence:
  // 1. switchCounter changes → reset hydrated synchronously during render
  // 2. Messages arrive → render invisible with resize="instant"
  // 3. StickToBottom's ResizeObserver fires → instant scroll to bottom
  // 4. Double-rAF ensures scroll is settled → reveal content at correct position
  //
  // Uses React's "set state during render" pattern to detect workspace switches
  // synchronously, even when React 18 batches the switch dispatch with the WS
  // history replay into a single render (which broke the old useEffect approach).
  const [prevSwitchCounter, setPrevSwitchCounter] = useState(switchCounter);
  const [hydrated, setHydrated] = useState(false);

  if (switchCounter !== prevSwitchCounter) {
    setPrevSwitchCounter(switchCounter);
    setHydrated(false);
  }

  const isHydrating = !hydrated && messages.length > 0;

  useEffect(() => {
    if (isHydrating) {
      let raf2: number;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setHydrated(true));
      });
      // Safety fallback: rAF can stall when the tab/window isn't focused
      // (background tabs, Tauri window transitions). Force reveal after 200ms.
      const fallback = setTimeout(() => setHydrated(true), 200);
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
        clearTimeout(fallback);
      };
    }
  }, [isHydrating]);

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

  const getPlanStatus = (msg: ChatMessageType, idx: number): PlanStatus | undefined => {
    const hasExitPlanMode = msg.toolCalls?.some((tc) => tc.name === "ExitPlanMode");
    if (!hasExitPlanMode) return undefined;
    if (isMessageInteractive(msg, idx)) return "interactive";
    // "Revised" only if a later assistant message also proposes a plan
    const hasLaterPlan = messages.slice(idx + 1).some(
      (m) => m.role === "assistant" && m.toolCalls?.some((tc) => tc.name === "ExitPlanMode"),
    );
    return hasLaterPlan ? "revised" : "approved";
  };

  return (
    <Conversation className={`flex-1${isHydrating ? " invisible" : ""}`} resize={isHydrating ? "instant" : "smooth"}>
      <ConversationContent className="gap-4 px-8 py-4">
        {!hasContent &&
          (workspaceName && projectName && branch && defaultBranch ? (
            <ConversationEmptyState className="py-20">
              <WorkspaceWelcome
                projectName={projectName}
                workspaceName={workspaceName}
                branch={branch}
                defaultBranch={defaultBranch}
                fileCount={fileCount ?? 0}
              />
            </ConversationEmptyState>
          ) : (
            <ConversationEmptyState
              className="py-20 text-sm text-muted-foreground"
              title="Send a message to start a conversation."
              description=""
            />
          ))}
        {messages.map((msg, i) => (
          <ChatMessage
            key={msg.id ?? `${msg.timestamp}-${i}`}
            message={msg}
            isInteractive={isMessageInteractive(msg, i)}
            planStatus={getPlanStatus(msg, i)}
            onQuestionAnswer={onQuestionAnswer}
            onPlanApproval={onPlanApproval}
            onHandOff={onHandOff}
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
                onHandOff={onHandOff}
              />
            </div>
          </div>
        )}

        {/* Live elapsed timer while streaming (not while awaiting user input) */}
        {isStreaming && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <AgentActivityPreview size="small" />
            <span>{formatElapsed(elapsed)}</span>
          </div>
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
