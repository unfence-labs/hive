import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { api } from "@/hooks/useApi";
import type { ToolOutputResponse } from "@/types";

/**
 * Provides the coordinates needed to lazily fetch a tool/activity's full output
 * on expand. REST history truncates large outputs to a preview plus scalars and
 * omits the body; the collapsed view reads the scalars, and expanding a
 * truncated tool fetches the full body from disk via this fetcher (keyed by the
 * ToolCall id, which also resolves a command_execution activity id).
 */
export interface ToolOutputContextValue {
  workspaceId: string;
  sessionId: string;
  /** Fetch the full output for a tool/activity id. Throws on network/404. */
  fetchOutput: (toolId: string) => Promise<string>;
}

const ToolOutputContext = createContext<ToolOutputContextValue | null>(null);

export function ToolOutputProvider({
  workspaceId,
  sessionId,
  children,
}: {
  workspaceId: string | undefined;
  sessionId: string | undefined;
  children: ReactNode;
}) {
  const fetchOutput = useCallback(
    async (toolId: string): Promise<string> => {
      if (!workspaceId || !sessionId) {
        throw new Error("Tool output is unavailable: missing session context.");
      }
      const res = await api.get<ToolOutputResponse>(
        `/api/workspaces/${workspaceId}/sessions/${sessionId}/tools/${encodeURIComponent(toolId)}/output`,
      );
      return res.output;
    },
    [workspaceId, sessionId],
  );

  const value = useMemo<ToolOutputContextValue | null>(
    () => (workspaceId && sessionId ? { workspaceId, sessionId, fetchOutput } : null),
    [workspaceId, sessionId, fetchOutput],
  );

  return <ToolOutputContext.Provider value={value}>{children}</ToolOutputContext.Provider>;
}

/** Access the lazy tool-output fetcher, or null when no session context exists. */
export function useToolOutput(): ToolOutputContextValue | null {
  return useContext(ToolOutputContext);
}
