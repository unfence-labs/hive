import { useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import type { ToolCall, QuestionAnswer } from "@/types";
import { isAskUserQuestion, isExitPlanMode } from "@/types";
import { cn } from "@/lib/utils";
import { findPlanContent } from "@/lib/plan-state";
import { buildChildrenMap, parseSubAgentInfo } from "@/lib/sub-agent";
import ChatToolUse, { getToolIcon } from "@/components/ChatToolUse";
import { SubAgentNode } from "@/components/chat/SubAgentNode";
import { AskUserQuestion } from "@/components/chat/AskUserQuestion";
import { PlanProposal, type PlanStatus } from "@/components/chat/PlanProposal";

const COLLAPSE_THRESHOLD = 3;

/** Recursively render tool calls, nesting children under their parent Task. */
export function ToolCallTree({
  tools,
  childrenMap,
  showExecutingState,
}: {
  tools: ToolCall[];
  childrenMap: Map<string, ToolCall[]>;
  showExecutingState?: boolean;
}) {
  return (
    <>
      {tools.map((tool) => {
        const children = childrenMap.get(tool.id);

        // Render Task/Agent tools as rich SubAgentNode
        if (tool.name === "Task" || tool.name === "Agent") {
          const info = parseSubAgentInfo(tool);
          if (info) {
            return (
              <SubAgentNode
                key={tool.id}
                tool={tool}
                info={info}
                children={children ?? []}
                childrenMap={childrenMap}
                showExecutingState={showExecutingState}
              />
            );
          }
        }

        // Non-Task tools with children (defensive fallback)
        if (children && children.length > 0) {
          return (
            <TaskNodeFallback
              key={tool.id}
              tool={tool}
              children={children}
              childrenMap={childrenMap}
              showExecutingState={showExecutingState}
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
    </>
  );
}

/** Fallback for non-Task tools that have children (shouldn't normally happen). */
function TaskNodeFallback({
  tool,
  children,
  childrenMap,
  showExecutingState,
}: {
  tool: ToolCall;
  children: ToolCall[];
  childrenMap: Map<string, ToolCall[]>;
  showExecutingState?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <ChatToolUse
        tool={tool}
        isExecuting={showExecutingState ? tool.output === undefined : undefined}
        onClick={() => setOpen(!open)}
      />
      {open && (
        <div className="ml-4 border-l-2 border-muted-foreground/20 pl-3">
          <ToolCallTree tools={children} childrenMap={childrenMap} showExecutingState={showExecutingState} />
        </div>
      )}
    </div>
  );
}

interface ToolCallListProps {
  toolCalls: ToolCall[];
  isInteractive?: boolean;
  showExecutingState?: boolean;
  planStatus?: PlanStatus;
  dismissedToolCallIds?: Set<string>;
  onQuestionAnswer?: (toolCallId: string, answers: QuestionAnswer[]) => void;
  className?: string;
}

export function ToolCallList({
  toolCalls,
  isInteractive,
  showExecutingState,
  planStatus,
  dismissedToolCallIds,
  onQuestionAnswer: _onQuestionAnswer,
  className,
}: ToolCallListProps) {
  const [expanded, setExpanded] = useState(false);

  if (toolCalls.length === 0) return null;

  const interactiveTools = toolCalls.filter(
    (t) => isAskUserQuestion(t) || isExitPlanMode(t),
  );

  // Detect plan content when ExitPlanMode is present (handles both Write and Edit flows)
  const hasExitPlanMode = toolCalls.some(isExitPlanMode);
  const planData = hasExitPlanMode ? findPlanContent(toolCalls) : undefined;
  const planContent = planData?.content;

  const HIDDEN_TASK_TOOLS = new Set(["TaskUpdate", "TodoList"]);

  const regularTools = toolCalls.filter(
    (t) =>
      !isAskUserQuestion(t) &&
      !isExitPlanMode(t) &&
      !HIDDEN_TASK_TOOLS.has(t.name) &&
      !(planData?.writeToolId && t.id === planData.writeToolId),
  );

  const childrenMap = buildChildrenMap(regularTools);
  const rootTools = regularTools.filter((t) => !t.parentToolUseId);

  const shouldCollapse = rootTools.length >= COLLAPSE_THRESHOLD;

  const uniqueToolNames = shouldCollapse
    ? [...new Set(rootTools.map((t) => t.name))]
    : [];

  // Build summary label: "N tool calls, M subagents"
  const summaryLabel = (() => {
    if (!shouldCollapse) return "";
    const subagentCount = rootTools.filter((t) => t.name === "Task" || t.name === "Agent").length;
    const toolCount = rootTools.length - subagentCount;
    const parts: string[] = [];
    if (toolCount > 0) parts.push(`${toolCount} tool call${toolCount !== 1 ? "s" : ""}`);
    if (subagentCount > 0) parts.push(`${subagentCount} subagent${subagentCount !== 1 ? "s" : ""}`);
    return parts.join(", ");
  })();

  return (
    <div className={cn("mt-2", className)}>
      {shouldCollapse && (
        <div className="my-0.5">
          <button
            type="button"
            className="inline-flex w-fit items-center gap-2 rounded-md py-1 pr-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
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
            {showExecutingState && (
              <span
                aria-hidden="true"
                className="inline-block size-1.5 shrink-0 animate-pulse rounded-full bg-primary"
              />
            )}
          </button>
        </div>
      )}

      {(!shouldCollapse || expanded) && (
        <ToolCallTree
          tools={rootTools}
          childrenMap={childrenMap}
          showExecutingState={showExecutingState}
        />
      )}

      {interactiveTools.map((tool) => {
        if (isAskUserQuestion(tool)) {
          return (
            <AskUserQuestion
              key={tool.id}
              tool={tool}
              isInteractive={isInteractive}
              isDismissed={dismissedToolCallIds?.has(tool.id)}
            />
          );
        }
        if (isExitPlanMode(tool)) {
          const effectiveStatus = planStatus ?? (isInteractive ? "interactive" : "approved");
          return (
            <PlanProposal
              key={tool.id}
              planContent={planContent}
              status={effectiveStatus}
            />
          );
        }
        return null;
      })}
    </div>
  );
}
