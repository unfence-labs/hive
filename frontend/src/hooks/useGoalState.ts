import { useMemo } from "react";
import type { AgentActivity, ChatMessage } from "@/types";

export type GoalState = Extract<AgentActivity, { kind: "goal_update" }>;

export function useGoalState(
  messages: ChatMessage[],
  activeAgentActivities: AgentActivity[] = [],
): GoalState | null {
  return useMemo(() => {
    let latest: GoalState | null = null;

    function readActivity(activity: AgentActivity) {
      if (activity.kind !== "goal_update") return;
      latest = activity.active ? activity : null;
    }

    for (const message of messages) {
      for (const activity of message.agentActivities ?? []) {
        readActivity(activity);
      }
    }

    for (const activity of activeAgentActivities) {
      readActivity(activity);
    }

    return latest;
  }, [messages, activeAgentActivities]);
}
