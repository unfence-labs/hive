import { useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import type { ToolCall, QuestionAnswer } from "@/types";
import { isAskUserQuestion, isExitPlanMode } from "@/types";
import { cn } from "@/lib/utils";
import ChatToolUse, { getToolIcon } from "@/components/ChatToolUse";
import { AskUserQuestion } from "@/components/chat/AskUserQuestion";
import { ExitPlanModeButton } from "@/components/chat/ExitPlanModeButton";

const COLLAPSE_THRESHOLD = 3;

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
  const [expanded, setExpanded] = useState(false);

  if (toolCalls.length === 0) return null;

  const interactiveTools = toolCalls.filter(
    (t) => isAskUserQuestion(t) || isExitPlanMode(t),
  );
  const regularTools = toolCalls.filter(
    (t) => !isAskUserQuestion(t) && !isExitPlanMode(t),
  );

  const shouldCollapse =
    !showExecutingState && regularTools.length >= COLLAPSE_THRESHOLD;

  const uniqueToolNames = shouldCollapse
    ? [...new Set(regularTools.map((t) => t.name))]
    : [];

  // Build summary label: "N tool calls, M subagents"
  const summaryLabel = (() => {
    if (!shouldCollapse) return "";
    const subagentCount = regularTools.filter((t) => t.name === "Task").length;
    const toolCount = regularTools.length - subagentCount;
    const parts: string[] = [];
    if (toolCount > 0) parts.push(`${toolCount} tool call${toolCount !== 1 ? "s" : ""}`);
    if (subagentCount > 0) parts.push(`${subagentCount} subagent${subagentCount !== 1 ? "s" : ""}`);
    return parts.join(", ");
  })();

  return (
    <div className="mt-2">
      {shouldCollapse && (
        <div className="my-0.5">
          <button
            type="button"
            className="inline-flex w-fit items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            onClick={() => setExpanded(!expanded)}
          >
            <ChevronRightIcon
              className={cn(
                "size-3.5 transition-transform",
                expanded && "rotate-90",
              )}
            />
            <span>{summaryLabel}</span>
            <span className="flex items-center gap-1 text-muted-foreground/50">
              {uniqueToolNames.map((name) => (
                <span key={name} className="shrink-0">
                  {getToolIcon(name)}
                </span>
              ))}
            </span>
          </button>
        </div>
      )}

      {(!shouldCollapse || expanded) &&
        regularTools.map((tool) => (
          <ChatToolUse
            key={tool.id}
            tool={tool}
            isExecuting={
              showExecutingState ? tool.output === undefined : undefined
            }
          />
        ))}

      {interactiveTools.map((tool) => {
        if (isAskUserQuestion(tool)) {
          return (
            <AskUserQuestion
              key={tool.id}
              tool={tool}
              isInteractive={isInteractive}
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
        return null;
      })}
    </div>
  );
}
