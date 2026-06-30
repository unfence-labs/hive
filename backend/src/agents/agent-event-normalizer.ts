import type {
  AgentActivityCommandAction,
  AgentActivityFile,
  CliJsonLine,
  ContentBlock,
  ServerToolResultType,
} from "../types.js";

type AssistantEvent = Extract<CliJsonLine, { type: "assistant" }>;
type UserEvent = Extract<CliJsonLine, { type: "user" }>;

type ServerResultBlock = Extract<ContentBlock,
  { type: ServerToolResultType } | { type: "mcp_tool_result" }
>;

export type NormalizedAgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "redacted_thinking"; text: string }
  | { type: "tool_started"; id: string; name: string; rawName: string; input: string; parentToolUseId?: string }
  | { type: "tool_updated"; id: string; input: string }
  | { type: "tool_completed"; id: string; output: string }
  | {
      type: "command_execution_updated";
      id: string;
      command?: string;
      cwd?: string;
      status?: string;
      outputDelta?: string;
      output?: string;
      exitCode?: number;
      durationMs?: number;
      commandActions?: AgentActivityCommandAction[];
    }
  | { type: "file_change_updated"; id: string; files?: AgentActivityFile[]; path?: string; diff?: string; status?: string; kind?: string }
  | { type: "image_view_updated"; id: string; path: string; relativePath?: string; outsideWorkspace?: boolean }
  | {
      type: "image_generation_updated";
      id: string;
      status?: string;
      revisedPrompt?: string;
      result?: string;
      savedPath?: string;
      relativePath?: string;
    }
  | { type: "plan_updated"; id: string; steps: Array<{ text: string; status: string }> }
  | {
      type: "goal_updated";
      id: string;
      active: boolean;
      threadId: string;
      objective?: string;
      status?: string;
      tokenBudget?: number | null;
      tokensUsed?: number;
      timeUsedSeconds?: number;
      createdAt?: number;
      updatedAt?: number;
    }
  | {
      type: "diagnostic";
      id: string;
      severity: "info" | "warning" | "error";
      title: string;
      message: string;
      source?: string;
      method?: string;
      details?: string;
    }
  | { type: "plan_mode_changed"; active: boolean }
  | { type: "usage_updated"; inputTokens: number; outputTokens: number };

/** Map Anthropic server_tool_use names to their Claude Code display names. */
const serverToolNameMap: Record<string, string> = {
  web_search: "WebSearch",
  web_fetch: "WebFetch",
  bash_code_execution: "Bash",
  text_editor_code_execution: "Edit",
};

export class AgentEventNormalizer {
  private readonly emittedToolIds = new Set<string>();

  handleAssistant(data: AssistantEvent): NormalizedAgentEvent[] {
    const events: NormalizedAgentEvent[] = [];
    // Subagent nesting comes straight from the Claude CLI, which stamps every
    // message with parent_tool_use_id (null at top level, the parent Task/Agent
    // id inside a subagent sidechain). It is the ground truth even when subagents
    // run in parallel, so we read it directly — no heuristic stack to mis-attribute.
    const messageParentToolUseId = data.parent_tool_use_id ?? undefined;

    for (const block of data.message.content) {
      switch (block.type) {
        case "text":
          events.push({ type: "text_delta", text: block.text });
          break;
        case "thinking":
          events.push({ type: "thinking_delta", text: block.thinking });
          break;
        case "tool_use":
        case "server_tool_use":
        case "mcp_tool_use": {
          const rawName = block.name;
          const name = block.type === "server_tool_use"
            ? (serverToolNameMap[block.name] ?? block.name)
            : block.name;
          const input = typeof block.input === "string"
            ? block.input
            : JSON.stringify(block.input, null, 2);
          const explicitParentToolUseId = "parentToolUseId" in block ? block.parentToolUseId : undefined;
          // Explicit per-block parent (Codex adapter) wins; otherwise the native
          // message-level parent. Absent or null both mean "top level".
          const parentToolUseId = explicitParentToolUseId ?? messageParentToolUseId;

          if (this.emittedToolIds.has(block.id)) {
            events.push({ type: "tool_updated", id: block.id, input });
          } else {
            this.emittedToolIds.add(block.id);
            events.push({ type: "tool_started", id: block.id, name, rawName, input, parentToolUseId });
          }

          if (rawName === "EnterPlanMode" || rawName === "ExitPlanMode") {
            events.push({ type: "plan_mode_changed", active: rawName === "EnterPlanMode" });
          }
          break;
        }
        case "redacted_thinking":
          events.push({ type: "redacted_thinking", text: "[redacted]\n" });
          break;
        case "web_search_tool_result":
        case "web_fetch_tool_result":
        case "bash_code_execution_tool_result":
        case "text_editor_code_execution_tool_result":
        case "mcp_tool_result":
          events.push({
            type: "tool_completed",
            id: block.tool_use_id,
            output: formatServerToolResult(block),
          });
          break;
      }
    }

    const usage = data.message.usage;
    if (usage) {
      events.push({
        type: "usage_updated",
        inputTokens:
          usage.input_tokens +
          (usage.cache_creation_input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0),
        outputTokens: usage.output_tokens,
      });
    }

    return events;
  }

  handleUser(data: UserEvent): NormalizedAgentEvent[] {
    const events: NormalizedAgentEvent[] = [];

    for (const block of data.message.content) {
      if (block.type !== "tool_result") continue;
      events.push({
        type: "tool_completed",
        id: block.tool_use_id,
        output: block.content,
      });
    }

    return events;
  }
}

/** Format server/MCP tool result content into a readable string. */
function formatServerToolResult(block: ServerResultBlock): string {
  const { content } = block;
  if (typeof content === "string") return content;

  switch (block.type) {
    case "web_search_tool_result": {
      if (!Array.isArray(content)) break;
      const summary = (content as Array<{ type?: string; title?: string; url?: string }>)
        .filter((r) => r.type === "web_search_result")
        .map((r) => `${r.title ?? "Result"}\n${r.url ?? ""}`)
        .join("\n\n");
      return summary || JSON.stringify(content);
    }
    case "bash_code_execution_tool_result": {
      if (!content || typeof content !== "object") break;
      const c = content as { stdout?: string; stderr?: string; return_code?: number };
      const parts: string[] = [];
      if (c.stdout) parts.push(c.stdout);
      if (c.stderr) parts.push(`stderr: ${c.stderr}`);
      if (c.return_code !== undefined && c.return_code !== 0) parts.push(`exit code: ${c.return_code}`);
      return parts.join("\n") || JSON.stringify(content);
    }
    case "mcp_tool_result": {
      if (!Array.isArray(content)) break;
      const texts = (content as Array<{ type?: string; text?: string }>)
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text!);
      return texts.join("\n\n") || JSON.stringify(content);
    }
  }

  return JSON.stringify(content);
}
