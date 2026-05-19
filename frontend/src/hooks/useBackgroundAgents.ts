import { useMemo } from "react";
import type { ChatMessage, ToolCall } from "@/types";
import { parseSubAgentInfo } from "@/lib/sub-agent";

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
        isRunning: activeToolIds.has(tool.id) && tool.output === undefined,
      });
    }

    if (agents.length === 0) return EMPTY;

    return {
      agents,
      runningCount: agents.filter((a) => a.isRunning).length,
    };
  }, [messages, activeToolCalls]);
}
