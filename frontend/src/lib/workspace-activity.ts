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

export function aggregateScriptRunning(
  workspaceIds: string[],
  liveData: Record<string, WorkspaceLiveData>,
): boolean {
  return workspaceIds.some((id) => liveData[id]?.scriptRunning === true);
}

export interface WorkspaceDiffTotals {
  additions: number;
  deletions: number;
}

/**
 * Sum additions/deletions across the workspace's full branch change (committed
 * vs default branch + working-tree changes). Returns null when no diff data is
 * available yet or there are no changes, so callers can render nothing.
 */
export function workspaceDiffTotals(data: WorkspaceLiveData | undefined): WorkspaceDiffTotals | null {
  const stats = data?.diffStats;
  if (!stats) return null;

  let additions = 0;
  let deletions = 0;
  for (const f of [...stats.committed, ...stats.uncommitted]) {
    additions += f.additions;
    deletions += f.deletions;
  }
  if (additions === 0 && deletions === 0) return null;

  return { additions, deletions };
}
