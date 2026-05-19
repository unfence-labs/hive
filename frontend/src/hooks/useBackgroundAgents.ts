import { useMemo } from "react";
import type { ChatMessage, ToolCall } from "@/types";
import { buildChildrenMap, parseSubAgentInfo } from "@/lib/sub-agent";
import { isSubAgentRunning } from "@/lib/sub-agent-status";

export interface BackgroundAgent {
  toolId: string;
  subagentType: string;
  description: string;
  model?: string;
  isRunning: boolean;
}

export interface BackgroundAgentsState {
  agents: BackgroundAgent[];
  runningCount: number;
}

const EMPTY: BackgroundAgentsState = {
  agents: [],
  runningCount: 0,
};

export function useBackgroundAgents(
  messages: ChatMessage[],
  activeToolCalls: ToolCall[],
): BackgroundAgentsState {
  return useMemo(() => {
    const toolsById = new Map<string, ToolCall>();
    for (const msg of messages) {
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) toolsById.set(tc.id, tc);
      }
    }
    for (const tc of activeToolCalls) toolsById.set(tc.id, tc);
    const childrenMap = buildChildrenMap([...toolsById.values()]);
    const activeToolIds = new Set(activeToolCalls.map((tool) => tool.id));

    const agents: BackgroundAgent[] = [];

    for (const tool of toolsById.values()) {
      if (tool.name !== "Task" && tool.name !== "Agent") continue;
      const info = parseSubAgentInfo(tool);
      if (!info || !info.runInBackground) continue;
      if (info.tool && info.tool !== "spawnAgent") continue;

      agents.push({
        toolId: tool.id,
        subagentType: info.subagentType,
        description: info.description,
        model: info.model,
        isRunning: isSubAgentRunning(tool, {
          showExecutingState: activeToolIds.has(tool.id) || hasActiveChild(tool.id, childrenMap, activeToolIds),
          children: childrenMap.get(tool.id) ?? [],
          childrenMap,
        }),
      });
    }

    if (agents.length === 0) return EMPTY;

    return {
      agents,
      runningCount: agents.filter((a) => a.isRunning).length,
    };
  }, [messages, activeToolCalls]);
}

function hasActiveChild(
  toolId: string,
  childrenMap: Map<string, ToolCall[]>,
  activeToolIds: Set<string>,
): boolean {
  const children = childrenMap.get(toolId) ?? [];
  return children.some((child) => activeToolIds.has(child.id) || hasActiveChild(child.id, childrenMap, activeToolIds));
}
