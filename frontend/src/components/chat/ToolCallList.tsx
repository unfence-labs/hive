import { useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import type { ToolCall, QuestionAnswer } from "@/types";
import { isAskUserQuestion, isExitPlanMode } from "@/types";
import { cn } from "@/lib/utils";
import ChatToolUse, { getToolIcon } from "@/components/ChatToolUse";
import { AskUserQuestion } from "@/components/chat/AskUserQuestion";
import { PlanProposal, type PlanStatus } from "@/components/chat/PlanProposal";
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

/** Check if a tool targets a .claude/plans/ file. */
function isPlanFileTool(tool: ToolCall, name: string): boolean {
  if (tool.name !== name) return false;
  try {
    const input = JSON.parse(tool.input);
    return typeof input.file_path === "string" && input.file_path.includes(".claude/plans/");
  } catch {
    return false;
  }
}

/** Strip line numbers from Read tool output (handles both tab and → separators). */
function stripLineNumbers(text: string): string {
  const lines = text.split("\n");
  const first = lines.find((l) => l.trim());
  if (first && /^\s*\d+[\t→]/.test(first)) {
    return lines.map((l) => l.replace(/^\s*\d+[\t→]/, "")).join("\n");
  }
  return text;
}

/**
 * Extract plan content from tool calls, handling both Write (initial) and
 * Read+Edit (refinement) flows. Returns content + the Write tool id to
 * filter from regular tools when present.
 */
function findPlanContent(
  toolCalls: ToolCall[],
): { content: string; writeToolId?: string; planPath?: string } | undefined {
  // 1. Write tool → full content available directly
  const writeTool = toolCalls.filter((t) => isPlanFileTool(t, "Write")).pop();
  if (writeTool) {
    try {
      const input = JSON.parse(writeTool.input) as { content?: string; file_path?: string };
      const content = input.content ?? "";
      return { content, writeToolId: writeTool.id, planPath: input.file_path };
    } catch {
      /* fall through */
    }
  }

  // 2. Edit tool → reconstruct from Read output + Edit diffs
  const editTools = toolCalls.filter((t) => isPlanFileTool(t, "Edit"));
  if (editTools.length > 0) {
    let planPath: string | undefined;
    try {
      planPath = JSON.parse(editTools[0].input).file_path;
    } catch {
      /* fall through */
    }

    if (planPath) {
      const readTool = [...toolCalls].reverse().find((t) => {
        if (t.name !== "Read" || !t.output) return false;
        try {
          return JSON.parse(t.input).file_path === planPath;
        } catch {
          return false;
        }
      });

      if (readTool?.output) {
        let content = stripLineNumbers(readTool.output);
        for (const edit of editTools) {
          try {
            const inp = JSON.parse(edit.input);
            if (
              inp.file_path === planPath &&
              typeof inp.old_string === "string" &&
              typeof inp.new_string === "string"
            ) {
              content = inp.replace_all
                ? content.replaceAll(inp.old_string, inp.new_string)
                : content.replace(inp.old_string, inp.new_string);
            }
          } catch {
            /* skip */
          }
        }
        return { content, planPath };
      }
    }
  }

  // 3. ExitPlanMode input → Claude passes the full plan content directly
  const exitTool = toolCalls.find((t) => t.name === "ExitPlanMode");
  if (exitTool) {
    try {
      const input = JSON.parse(exitTool.input);
      if (typeof input.plan === "string" && input.plan.trim()) {
        const planPath = typeof input.file_path === "string" ? input.file_path : undefined;
        return { content: input.plan, planPath };
      }
    } catch {
      /* fall through */
    }
  }

  return undefined;
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
  planStatus?: PlanStatus;
  onQuestionAnswer?: (toolCallId: string, answers: QuestionAnswer[]) => void;
  onPlanApproval?: () => void;
  onHandOff?: (planContent: string, planPath?: string) => void;
}

export function ToolCallList({
  toolCalls,
  isInteractive,
  showExecutingState,
  planStatus,
  onQuestionAnswer: _onQuestionAnswer,
  onPlanApproval,
  onHandOff,
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

  const regularTools = toolCalls.filter(
    (t) =>
      !isAskUserQuestion(t) &&
      !isExitPlanMode(t) &&
      !(planData?.writeToolId && t.id === planData.writeToolId),
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
          const effectiveStatus = planStatus ?? (isInteractive ? "interactive" : "approved");
          return (
            <PlanProposal
              key={tool.id}
              planContent={planContent}
              planPath={planData?.planPath}
              status={effectiveStatus}
              onApprove={onPlanApproval}
              onHandOff={onHandOff}
            />
          );
        }
        return null;
      })}
    </div>
  );
}
