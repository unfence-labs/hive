import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { prefetchSessionMessages } from "@/hooks/useSessionMessages";
import { useSessions } from "@/hooks/useSessions";
import { useBrain } from "@/hooks/useBrain";
import { BRAIN_WORKSPACE_ID } from "@/lib/brain";
import type { Project } from "@/types";

/**
 * Prewarm the REST history cache for the entry session of every conversation
 * context — each workspace AND the Brain — at app bootstrap, so the FIRST switch
 * into any of them finds warm data. React Query `isLoading` stays false, so no
 * empty-state blank while the fetch resolves.
 *
 * The per-context prewarm in {@link useConversationColumn} only warms the
 * *other* (non-entry) sessions of the *currently open* context: it can't warm a
 * context before you enter it, and it excludes the entry session by design (that
 * one fetches itself on display). This closes that gap — the "everything warm"
 * property the old WebSocket bootstrap had before the REST-owned history
 * refactor — and unifies workspaces and the Brain under one boot path.
 *
 * Entry session per context:
 * - Workspaces: `activeSessionId` + `lastActivityAt` already ride on the
 *   `/api/projects` payload, so no extra request is needed to know them.
 * - Brain: it carries no inline `activeSessionId`, so we mirror the server's
 *   default-session pick (`getDefaultBrainSessionId`: most-recently-updated
 *   non-empty session) from its sessions list. The list is fetched only when a
 *   Brain exists (`useBrain` is already loaded at boot by the sidebar, a cache
 *   hit) and shares the `useSessions` cache key, so it also warms BrainView.
 *
 * Bounded to the most-recently-active workspaces to keep the boot request burst
 * small (boot is the most latency-sensitive moment); older workspaces fall back
 * to lazy load on switch. Pure additive optimization: `prefetchQuery` dedupes by
 * key and no-ops while fresh, so nothing depends on it completing.
 */
const PREWARM_WORKSPACE_LIMIT = 15;

export function useActiveSessionPrewarm(projects: Project[]): void {
  const queryClient = useQueryClient();
  const { brain } = useBrain();
  // Reuse the sessions query (same cache key as BrainView) but only when a Brain
  // exists — passing undefined disables it, so users without a Brain make no
  // request. This also warms BrainView's own session list as a side benefit.
  const { sessions: brainSessions } = useSessions(brain.exists ? BRAIN_WORKSPACE_ID : undefined);

  useEffect(() => {
    const targets = projects
      .flatMap((project) => project.workspaces ?? [])
      .filter((workspace) => !!workspace.activeSessionId)
      // Most-recently-active first; workspaces without lastActivityAt sink last.
      // lastActivityAt is an ISO 8601 string, which sorts lexicographically.
      .sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""))
      .slice(0, PREWARM_WORKSPACE_LIMIT)
      .map((workspace) => ({ wsId: workspace.id, sessionId: workspace.activeSessionId! }));

    // Brain entry session: most-recently-updated non-empty session, matching the
    // server's getDefaultBrainSessionId fallback. Empty sessions have no history
    // to warm; terminals never exist on the Brain.
    const brainEntry = brainSessions
      .filter((session) => session.assistantMessageCount > 0)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (brainEntry) {
      targets.push({ wsId: BRAIN_WORKSPACE_ID, sessionId: brainEntry.sessionId });
    }

    for (const target of targets) {
      prefetchSessionMessages(queryClient, target.wsId, target.sessionId);
    }
  }, [projects, brainSessions, queryClient]);
}
