import type { ToolCall } from "@/types";

export interface SubAgentInfo {
  subagentType: string;
  description: string;
  prompt?: string;
  runInBackground: boolean;
  model?: string;
  tool?: string;
}

/** Parse sub-agent metadata from a Task/Agent tool's input JSON. */
export function parseSubAgentInfo(tool: ToolCall): SubAgentInfo | null {
  if (tool.name !== "Task" && tool.name !== "Agent") return null;
  try {
    const input = JSON.parse(tool.input);
    return {
      subagentType: input.subagent_type ?? "Agent",
      description: input.description ?? "",
      prompt: input.prompt,
      runInBackground: input.run_in_background === true,
      model: input.model,
      tool: input.tool,
    };
  } catch {
    return null;
  }
}

/** Build a map of parentToolUseId → children for hierarchical rendering. */
export function buildChildrenMap(tools: ToolCall[]): Map<string, ToolCall[]> {
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
