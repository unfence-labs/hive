import type { ToolCall, QuestionAnswer } from "@/types";
import { isAskUserQuestion, isExitPlanMode } from "@/types";
import ChatToolUse from "@/components/ChatToolUse";
import { AskUserQuestion } from "@/components/chat/AskUserQuestion";
import { ExitPlanModeButton } from "@/components/chat/ExitPlanModeButton";

interface ToolCallListProps {
  toolCalls: ToolCall[];
  isInteractive?: boolean;
  showExecutingState?: boolean;
  onQuestionAnswer?: (toolCallId: string, answers: QuestionAnswer[]) => void;
  onPlanApproval?: () => void;
  onRejectToolInput?: (message?: string) => void;
}

export function ToolCallList({
  toolCalls,
  isInteractive,
  showExecutingState,
  onQuestionAnswer,
  onPlanApproval,
  onRejectToolInput,
}: ToolCallListProps) {
  if (toolCalls.length === 0) return null;

  return (
    <div className="mt-2">
      {toolCalls.map((tool) => {
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
              isInteractive={isInteractive}
              onApprove={onPlanApproval}
              onReject={onRejectToolInput}
            />
          );
        }
        return (
          <ChatToolUse
            key={tool.id}
            tool={tool}
            isExecuting={showExecutingState ? tool.output === undefined : undefined}
          />
        );
      })}
    </div>
  );
}
