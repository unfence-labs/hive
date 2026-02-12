import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "./useApi";
import type { DiffFileStat, DiffStatResponse } from "@/types";

const EMPTY: DiffFileStat[] = [];

export function useDiffStat(wsId: string | undefined) {
  const [committed, setCommitted] = useState<DiffFileStat[]>(EMPTY);
  const [uncommitted, setUncommitted] = useState<DiffFileStat[]>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!wsId) {
      setCommitted(EMPTY);
      setUncommitted(EMPTY);
      return;
    }
    setLoading(true);
    try {
      const result = await api.get<DiffStatResponse>(
        `/api/workspaces/${wsId}/diff/stat`,
      );
      setCommitted(result.committed);
      setUncommitted(result.uncommitted);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch diff stats");
    } finally {
      setLoading(false);
    }
  }, [wsId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const totalCount = useMemo(() => {
    const files = new Set<string>();
    for (const f of committed) files.add(f.file);
    for (const f of uncommitted) files.add(f.file);
    return files.size;
  }, [committed, uncommitted]);

  return { committed, uncommitted, totalCount, loading, error, refresh };
}
