import { useState, useCallback } from "react";
import { parsePatchFiles, type ParsedPatch } from "@pierre/diffs";
import { api } from "./useApi";

export function useDiff(wsId: string | undefined) {
  const [patchFiles, setPatchFiles] = useState<ParsedPatch[]>([]);
  const [rawDiff, setRawDiff] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDiff = useCallback(async () => {
    if (!wsId) return;
    setLoading(true);
    setError(null);
    try {
      const { diff } = await api.get<{ diff: string }>(
        `/api/workspaces/${wsId}/diff`,
      );
      setRawDiff(diff);
      setPatchFiles(diff ? parsePatchFiles(diff) : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch diff");
    } finally {
      setLoading(false);
    }
  }, [wsId]);

  return { patchFiles, rawDiff, loading, error, fetchDiff };
}
