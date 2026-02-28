import type { ToolCall } from "@/types";

export interface SubAgentInfo {
  subagentType: string;
  description: string;
  prompt?: string;
  runInBackground: boolean;
  model?: string;
}

/** Parse sub-agent metadata from a Task tool's input JSON. */
export function parseSubAgentInfo(tool: ToolCall): SubAgentInfo | null {
  if (tool.name !== "Task") return null;
  try {
    const input = JSON.parse(tool.input);
    return {
      subagentType: input.subagent_type ?? "Agent",
      description: input.description ?? "",
      prompt: input.prompt,
      runInBackground: input.run_in_background === true,
      model: input.model,
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

/** Recursively count all descendant tools under a given parent. */
export function getSubAgentChildCount(
  toolId: string,
  childrenMap: Map<string, ToolCall[]>,
): number {
  const children = childrenMap.get(toolId);
  if (!children) return 0;
  let count = children.length;
  for (const child of children) {
    count += getSubAgentChildCount(child.id, childrenMap);
  }
  return count;
}
