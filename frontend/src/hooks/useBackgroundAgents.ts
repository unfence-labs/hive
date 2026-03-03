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
    const allTools: ToolCall[] = [];
    for (const msg of messages) {
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) allTools.push(tc);
      }
    }
    for (const tc of activeToolCalls) allTools.push(tc);

    const agents: BackgroundAgent[] = [];

    for (const tool of allTools) {
      if (tool.name !== "Task" && tool.name !== "Agent") continue;
      const info = parseSubAgentInfo(tool);
      if (!info || !info.runInBackground) continue;

      agents.push({
        toolId: tool.id,
        subagentType: info.subagentType,
        description: info.description,
        model: info.model,
        isRunning: tool.output === undefined,
      });
    }

    if (agents.length === 0) return EMPTY;

    return {
      agents,
      runningCount: agents.filter((a) => a.isRunning).length,
    };
  }, [messages, activeToolCalls]);
}
