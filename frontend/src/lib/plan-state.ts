import type { ChatMessage, ToolCall } from "@/types";

interface PendingToolLike {
  toolName: string;
}

export function hasExitPlanModeTool(message: Pick<ChatMessage, "toolCalls"> | undefined): boolean {
  return message?.toolCalls?.some((tool) => tool.name === "ExitPlanMode") === true;
}

export function hasPendingExitPlanModeInput(pendingToolInputs: PendingToolLike[]): boolean {
  return pendingToolInputs.some((input) => input.toolName === "ExitPlanMode");
}

export function getFallbackInteractiveAssistantIndex(
  messages: ChatMessage[],
  isStreaming: boolean,
): number {
  if (isStreaming) return -1;

  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant") {
      lastAssistantIdx = i;
      break;
    }
  }
  if (lastAssistantIdx < 0) return -1;

  const hasUserAfterLastAssistant = messages
    .slice(lastAssistantIdx + 1)
    .some((message) => message.role === "user");
  return hasUserAfterLastAssistant ? -1 : lastAssistantIdx;
}

export function isPlanAwaitingUserInput(params: {
  messages: ChatMessage[];
  isStreaming: boolean;
  pendingToolInputs: PendingToolLike[];
}): boolean {
  const { messages, isStreaming, pendingToolInputs } = params;
  if (hasPendingExitPlanModeInput(pendingToolInputs)) return true;

  const fallbackInteractiveIdx = getFallbackInteractiveAssistantIndex(messages, isStreaming);
  if (fallbackInteractiveIdx < 0) return false;
  return hasExitPlanModeTool(messages[fallbackInteractiveIdx]);
}

// -- Plan content extraction (moved from ToolCallList) --

/** Check if a tool targets a .claude/plans/ file. */
export function isPlanFileTool(tool: ToolCall, name: string): boolean {
  if (tool.name !== name) return false;
  try {
    const input = JSON.parse(tool.input);
    return typeof input.file_path === "string" && input.file_path.includes(".claude/plans/");
  } catch {
    return false;
  }
}

/** Strip line numbers from Read tool output (handles both tab and → separators). */
export function stripLineNumbers(text: string): string {
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
export function findPlanContent(
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
    const candidatePaths = [...new Set(
      editTools
        .map((edit) => {
          try {
            const parsed = JSON.parse(edit.input) as { file_path?: unknown };
            return typeof parsed.file_path === "string" ? parsed.file_path : undefined;
          } catch {
            return undefined;
          }
        })
        .filter((path): path is string => typeof path === "string"),
    )].reverse();

    for (const planPath of candidatePaths) {
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

  // 4. Fallback: last Write tool to any .md file (plan may not live in .claude/plans/)
  const mdWriteTool = toolCalls.filter((t) => {
    if (t.name !== "Write") return false;
    try {
      const input = JSON.parse(t.input);
      return typeof input.file_path === "string" && input.file_path.endsWith(".md");
    } catch {
      return false;
    }
  }).pop();
  if (mdWriteTool) {
    try {
      const input = JSON.parse(mdWriteTool.input) as { content?: string; file_path?: string };
      const content = input.content ?? "";
      if (content.trim()) {
        return { content, writeToolId: mdWriteTool.id, planPath: input.file_path };
      }
    } catch {
      /* fall through */
    }
  }

  return undefined;
}
