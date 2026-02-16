import { useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import type { ToolCall, QuestionAnswer } from "@/types";
import { isAskUserQuestion, isExitPlanMode } from "@/types";
import { cn } from "@/lib/utils";
import ChatToolUse, { getToolIcon } from "@/components/ChatToolUse";
import { AskUserQuestion } from "@/components/chat/AskUserQuestion";
import { ExitPlanModeButton } from "@/components/chat/ExitPlanModeButton";
import { PlanProposal } from "@/components/chat/PlanProposal";
import { ContentPanel, ContentPanelBody } from "@/components/chat/ContentPanel";

const COLLAPSE_THRESHOLD = 3;

/** Build a map of parentToolUseId → children for hierarchical rendering. */
function buildChildrenMap(tools: ToolCall[]): Map<string, ToolCall[]> {
  const map = new Map<string, ToolCall[]>();
  for (const tool of tools) {
    if (tool.parentToolUseId) {
      const children = map.get(tool.parentToolUseId) ?? [];
      children.push(tool);
      map.set(tool.parentToolUseId, children);
    }
  }
  return map;
}

/** Extract the prompt text from a Task tool's input JSON. */
function getTaskPrompt(tool: ToolCall): string | undefined {
  try {
    const input = JSON.parse(tool.input);
    return input.prompt ?? input.description;
  } catch {
    return undefined;
  }
}

/** Check if a tool call is a Write to the .claude/plans/ directory. */
function isPlanWriteTool(tool: ToolCall): boolean {
  if (tool.name !== "Write") return false;
  try {
    const input = JSON.parse(tool.input);
    return typeof input.file_path === "string" && input.file_path.includes(".claude/plans/");
  } catch {
    return false;
  }
}

/** Extract the markdown content from a plan Write tool. */
function getPlanContent(tool: ToolCall): string {
  try {
    return (JSON.parse(tool.input).content as string) ?? "";
  } catch {
    return "";
  }
}

/** A single Task node whose children are collapsed by default. */
function TaskNode({
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
  const [promptOpen, setPromptOpen] = useState(false);
  const prompt = open ? getTaskPrompt(tool) : undefined;

  return (
    <div>
      <ChatToolUse
        tool={tool}
        isExecuting={showExecutingState ? tool.output === undefined : undefined}
        onClick={() => setOpen(!open)}
      />
      {open && (
        <div className="ml-4 border-l-2 border-muted-foreground/20 pl-3">
          {prompt && (
            <div className="my-0.5">
              <button
                type="button"
                className="inline-flex w-fit items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                onClick={() => setPromptOpen(!promptOpen)}
              >
                <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <span>Prompt</span>
              </button>
              {promptOpen && (
                <ContentPanel>
                  <ContentPanelBody>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-muted-foreground">
                      {prompt}
                    </pre>
                  </ContentPanelBody>
                </ContentPanel>
              )}
            </div>
          )}
          <ToolCallTree tools={children} childrenMap={childrenMap} showExecutingState={showExecutingState} />
        </div>
      )}
    </div>
  );
}

/** Recursively render tool calls, nesting children under their parent Task. */
function ToolCallTree({
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
        if (children && children.length > 0) {
          return (
            <TaskNode
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

interface ToolCallListProps {
  toolCalls: ToolCall[];
  isInteractive?: boolean;
  showExecutingState?: boolean;
  onQuestionAnswer?: (toolCallId: string, answers: QuestionAnswer[]) => void;
  onPlanApproval?: () => void;
  onRejectToolInput?: (message?: string) => void;
  onHandOff?: (planContent: string) => void;
}

export function ToolCallList({
  toolCalls,
  isInteractive,
  showExecutingState,
  onQuestionAnswer: _onQuestionAnswer,
  onPlanApproval,
  onRejectToolInput,
  onHandOff,
}: ToolCallListProps) {
  const [expanded, setExpanded] = useState(false);

  if (toolCalls.length === 0) return null;

  const interactiveTools = toolCalls.filter(
    (t) => isAskUserQuestion(t) || isExitPlanMode(t),
  );

  // Detect plan Write tool when ExitPlanMode is present
  const hasExitPlanMode = toolCalls.some(isExitPlanMode);
  const planWriteTool = hasExitPlanMode
    ? toolCalls.filter(isPlanWriteTool).pop()
    : undefined;
  const planContent = planWriteTool ? getPlanContent(planWriteTool) : undefined;

  const regularTools = toolCalls.filter(
    (t) =>
      !isAskUserQuestion(t) &&
      !isExitPlanMode(t) &&
      !(planWriteTool && t.id === planWriteTool.id),
  );

  const childrenMap = buildChildrenMap(regularTools);
  const rootTools = regularTools.filter((t) => !t.parentToolUseId);

  const shouldCollapse =
    !showExecutingState && regularTools.length >= COLLAPSE_THRESHOLD;

  const uniqueToolNames = shouldCollapse
    ? [...new Set(rootTools.map((t) => t.name))]
    : [];

  // Build summary label: "N tool calls, M subagents"
  const summaryLabel = (() => {
    if (!shouldCollapse) return "";
    const subagentCount = rootTools.filter((t) => t.name === "Task").length;
    const toolCount = rootTools.length - subagentCount;
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
            className="inline-flex w-fit items-center gap-2 rounded-md py-1.5 pr-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
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
            />
          );
        }
        if (isExitPlanMode(tool)) {
          if (planContent) {
            return (
              <PlanProposal
                key={tool.id}
                planContent={planContent}
                isInteractive={isInteractive}
                onApprove={onPlanApproval}
                onHandOff={onHandOff}
              />
            );
          }
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
