import { useState, useEffect, useCallback } from "react";
import { api } from "./useApi";

export function useResource<T>(url: string | null) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(!!url);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!url) return;
    try {
      setLoading(true);
      const result = await api.get<T[]>(url);
      setData(result);
      setError(null);
    } catch (e) {
      setData([]);
      setError(e instanceof Error ? e.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, loading, error, refresh, setData };
}
