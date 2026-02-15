import { useState, useEffect } from "react";
import { api } from "./useApi";
import type { CompletionItem } from "@/types";

interface CompletionsResponse {
  items: CompletionItem[];
}

export function useCompletions(wsId: string | undefined): CompletionItem[] {
  const [items, setItems] = useState<CompletionItem[]>([]);

  useEffect(() => {
    if (!wsId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    api
      .get<CompletionsResponse>(`/api/workspaces/${wsId}/completions`)
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch(() => {
        // Autocomplete is optional UX — silently ignore errors
      });
    return () => {
      cancelled = true;
    };
  }, [wsId]);

  return items;
}
