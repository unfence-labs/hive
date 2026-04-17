import type { WorkspaceLiveData } from "@/hooks/useWorkspaceLiveData";

export type ActivityState = "streaming" | "unread" | "idle";

export function workspaceActivityState(data: WorkspaceLiveData | undefined): ActivityState {
  if (!data) return "idle";
  if (data.streaming) return "streaming";
  if (data.unreadSessions && Object.keys(data.unreadSessions).length > 0) return "unread";
  return "idle";
}

const PRIORITY: Record<ActivityState, number> = {
  streaming: 2,
  unread: 1,
  idle: 0,
};

export function aggregateActivityState(states: ActivityState[]): ActivityState {
  let best: ActivityState = "idle";
  for (const s of states) {
    if (PRIORITY[s] > PRIORITY[best]) best = s;
  }
  return best;
}

export function aggregateWorkspaceActivity(
  workspaceIds: string[],
  liveData: Record<string, WorkspaceLiveData>,
): ActivityState {
  return aggregateActivityState(workspaceIds.map((id) => workspaceActivityState(liveData[id])));
}
