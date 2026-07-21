import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
  ConversationScrollLockReEngager,
  ConversationScrollTrigger,
} from "@/components/ai-elements/conversation";
import ChatMessage from "@/components/ChatMessage";
import { ConversationFind } from "@/components/chat/ConversationFind";
import AgentActivityPreview from "@/components/chat/AgentActivityPreview";
import { MessageResponse } from "@/components/ai-elements/message";
import { ThinkingBlock } from "@/components/chat/ThinkingBlock";
import { AgentActivityList, getInlineAgentActivities } from "@/components/chat/AgentActivityList";
import { WorkspaceWelcome } from "@/components/WorkspaceWelcome";
import { formatElapsed } from "@/lib/time";
import { getFallbackInteractiveAssistantIndex, hasExitPlanModeTool } from "@/lib/plan-state";
import { Trash2Icon } from "lucide-react";
import type { AgentActivity, ChatMessage as ChatMessageType, QueuedMessage, ReasoningSegment, ToolCall, QuestionAnswer } from "@/types";
import type { PendingToolInput } from "@/hooks/useConversation";
import type { PlanStatus } from "@/components/chat/PlanProposal";

interface ChatConversationProps {
  messages: ChatMessageType[];
  /**
   * True only during a cache-miss first history load. While loading, the
   * message area stays deliberately blank (no skeleton) instead of flashing
   * the empty state before the fetched messages arrive.
   */
  isHistoryLoading?: boolean;
  isHistoryError?: boolean;
  isStreaming: boolean;
  streamingStartedAt?: number | null;
  currentStreamingText: string;
  currentReasoningSegments: ReasoningSegment[];
  activeToolCalls: ToolCall[];
  activeAgentActivities: AgentActivity[];
  pendingToolInputs?: PendingToolInput[];
  onQuestionAnswer?: (toolCallId: string, answers: QuestionAnswer[]) => void;
  onFileMentionClick?: (relativePath: string) => void;
  /** When set, the workspace welcome offers a button to open a terminal tab. */
  onStartTerminal?: () => void;
  workspaceName?: string;
  projectName?: string;
  branch?: string;
  defaultBranch?: string;
  fileCount?: number;
  switchCounter: number;
  error?: string;
  agentPlanMode?: boolean;
  queuedMessage?: QueuedMessage | null;
  onClearQueue?: () => void;
  scrollToBottomTrigger?: number;
  /**
   * Page-specific empty-state content shown when there are no messages and the
   * workspace-welcome props are absent (e.g. the Brain). Falls back to the
   * generic prompt when omitted.
   */
  emptyState?: ReactNode;
}

export default function ChatConversation({
  messages,
  isHistoryLoading = false,
  isHistoryError = false,
  isStreaming,
  streamingStartedAt,
  currentStreamingText,
  currentReasoningSegments,
  activeToolCalls,
  activeAgentActivities = [],
  pendingToolInputs = [],
  onQuestionAnswer,
  onFileMentionClick,
  onStartTerminal,
  workspaceName,
  projectName,
  branch,
  defaultBranch,
  fileCount,
  switchCounter,
  agentPlanMode,
  error,
  queuedMessage,
  onClearQueue,
  scrollToBottomTrigger = 0,
  emptyState,
}: ChatConversationProps) {
  const [elapsed, setElapsed] = useState(0);
  const activeInlineAgentActivities = getInlineAgentActivities(activeAgentActivities);

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
  // 1. switchCounter changes → reset hydrated+settled synchronously during render
  // 2. Messages arrive → render invisible with resize="instant"
  // 3. StickToBottom's ResizeObserver fires → instant scroll to bottom
  // 4. Double-rAF ensures scroll is settled → reveal content at correct position
  // 5. Settling period keeps resize="instant" so late layout shifts (Streamdown
  //    plugin processing, syntax highlighting, images) are absorbed silently
  // 6. After settling → resize="smooth" for normal interaction
  //
  // Uses React's "set state during render" pattern to detect workspace switches
  // synchronously, even when React batches the switch dispatch with REST history
  // hydration into a single render (which broke the old useEffect approach).
  const [prevSwitchCounter, setPrevSwitchCounter] = useState(switchCounter);
  const [hydrated, setHydrated] = useState(false);
  const [settled, setSettled] = useState(false);

  if (switchCounter !== prevSwitchCounter) {
    setPrevSwitchCounter(switchCounter);
    setHydrated(false);
    setSettled(false);
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

  // Keep resize="instant" for a settling period after reveal so that late
  // layout shifts (async syntax highlighting, plugin rendering) don't cause
  // a visible smooth-scroll animation.
  useEffect(() => {
    if (hydrated && !settled) {
      const timer = setTimeout(() => setSettled(true), 300);
      return () => clearTimeout(timer);
    }
  }, [hydrated, settled]);

  const hasContent = messages.length > 0 || isStreaming;

  // A message is interactive if it contains tool calls that match pending tool inputs.
  // Fallback to the old heuristic (last assistant message, no user after) when no pending inputs.
  const hasPendingInputs = pendingToolInputs.length > 0;
  const pendingToolUseIds = new Set(pendingToolInputs.map((p) => p.toolUseId));
  const fallbackInteractiveAssistantIdx = getFallbackInteractiveAssistantIndex(messages, isStreaming);

  const isMessageInteractive = (msg: ChatMessageType, idx: number): boolean => {
    if (hasPendingInputs) {
      return msg.toolCalls?.some((tc) => pendingToolUseIds.has(tc.id)) ?? false;
    }
    return idx === fallbackInteractiveAssistantIdx;
  };

  const getPlanStatus = (msg: ChatMessageType, idx: number): PlanStatus | undefined => {
    if (!hasExitPlanModeTool(msg)) return undefined;
    if (isMessageInteractive(msg, idx)) return "interactive";
    // "Revised" if a later assistant message also proposes a plan,
    // or if the agent is streaming after the user sent a revision (user message after plan)
    const after = messages.slice(idx + 1);
    const hasLaterPlan = after.some(
      (m) => m.role === "assistant" && hasExitPlanModeTool(m),
    );
    if (hasLaterPlan) return "revised";
    // While streaming after a rejection, agentPlanMode stays true — mark as revised
    // even before the new plan arrives. After approval, agentPlanMode is false.
    if (isStreaming && agentPlanMode && after.some((m) => m.role === "user")) return "revised";
    return "approved";
  };

  const dismissedToolCallIds = useMemo(() => {
    const ids = new Set<string>();
    for (let i = 0; i < messages.length - 1; i++) {
      const msg = messages[i];
      const next = messages[i + 1];
      if (
        msg.role === "assistant" &&
        next?.role === "user" &&
        next.content === "Question dismissed."
      ) {
        msg.toolCalls
          ?.filter((tc) => tc.name === "AskUserQuestion")
          .forEach((tc) => ids.add(tc.id));
      }
    }
    return ids;
  }, [messages]);

  return (
    <Conversation
      // Remount the scroll container on every switch. use-stick-to-bottom keeps
      // its `isAtBottom`/`escapedFromLock` state on the mounted instance, so once
      // the user scrolls up in one conversation that "escaped" state persists into
      // the next one and its ResizeObserver bails out of scroll-to-bottom (it only
      // re-sticks when already at the bottom). A fresh mount resets that state and
      // re-runs `initial="instant"`, so each conversation reliably opens at the
      // newest message. switchCounter is bumped only on real session/workspace
      // switches, never on streaming, so this never remounts mid-conversation.
      key={switchCounter}
      className={`flex-1${isHydrating ? " invisible" : ""}`}
      resize={settled ? "smooth" : "instant"}
    >
      {error && (
        <div className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <ConversationContent className="gap-4 px-8 py-4">
        {!hasContent &&
          !isHistoryLoading &&
          !isHistoryError &&
          (workspaceName && projectName && branch && defaultBranch ? (
            <ConversationEmptyState className="py-20">
              <WorkspaceWelcome
                projectName={projectName}
                workspaceName={workspaceName}
                branch={branch}
                defaultBranch={defaultBranch}
                fileCount={fileCount ?? 0}
                onStartTerminal={onStartTerminal}
              />
            </ConversationEmptyState>
          ) : emptyState ? (
            <ConversationEmptyState className="py-20">
              {emptyState}
            </ConversationEmptyState>
          ) : (
            <ConversationEmptyState
              className="py-20 text-sm text-muted-foreground"
              title="Send a message to start a conversation."
              description=""
            />
          ))}
        {messages.map((msg, i) => {
          // Hide "Question dismissed." user bubbles — the CANCELLED badge already conveys this
          if (msg.role === "user" && msg.content === "Question dismissed.") return null;
          return (
            <ChatMessage
              key={msg.id ?? `${msg.timestamp}-${i}`}
              message={msg}
              isInteractive={isMessageInteractive(msg, i)}
              planStatus={getPlanStatus(msg, i)}
              dismissedToolCallIds={dismissedToolCallIds}
              onQuestionAnswer={onQuestionAnswer}
              onFileMentionClick={onFileMentionClick}
            />
          );
        })}

        {/* Live streaming content */}
        {isStreaming && (currentStreamingText || currentReasoningSegments.length > 0 || activeToolCalls.length > 0 || activeInlineAgentActivities.length > 0) && (
          <div className="flex w-full justify-start">
            <div className="max-w-[85%] text-sm leading-relaxed text-foreground">
              <ThinkingBlock
                segments={currentReasoningSegments}
                streaming
              />
              {currentStreamingText && (
                <div className="prose-sm" data-find-content="">
                  <MessageResponse isAnimating>{currentStreamingText}</MessageResponse>
                </div>
              )}
              <AgentActivityList
                activities={activeInlineAgentActivities}
                toolCalls={activeToolCalls}
                isInteractive
                showExecutingState
                onQuestionAnswer={onQuestionAnswer}
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

        {/* Queued follow-up message */}
        {queuedMessage && (
          <div className="flex w-full flex-col items-end gap-0.5" data-testid="queued-message">
            <div className="group/queued relative max-w-[85%] rounded-[10px] rounded-br-[2px] border border-dashed border-primary/40 bg-transparent px-3.5 py-2 text-sm leading-relaxed text-foreground/70">
              <p className="whitespace-pre-wrap">{queuedMessage.content}</p>
              <button
                type="button"
                onClick={onClearQueue}
                className="absolute -top-2 -right-2 flex size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover/queued:opacity-100"
                aria-label="Cancel queued message"
              >
                <Trash2Icon className="size-3" />
              </button>
            </div>
            <span className="pr-1 text-[10px] text-muted-foreground">Queued</span>
          </div>
        )}
      </ConversationContent>
      <ConversationScrollButton />
      <ConversationScrollLockReEngager />
      <ConversationScrollTrigger trigger={scrollToBottomTrigger} />
      <ConversationFind switchCounter={switchCounter} />
    </Conversation>
  );
}
