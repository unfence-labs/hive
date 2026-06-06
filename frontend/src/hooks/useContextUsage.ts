import { useMemo } from "react";
import type { ChatMessage, ModelCatalogEntry } from "@/types";

export interface ContextUsageData {
  /** Tokens currently occupying the model context window. */
  inputTokens: number | null;
  /** Total output tokens for last turn. */
  outputTokens: number | null;
  /** Context window size for the selected model. */
  contextWindow: number | null;
  /** Usage as a fraction 0–1. null if no data. */
  usageFraction: number | null;
}

export function useContextUsage(
  messages: ChatMessage[],
  selectedModel: ModelCatalogEntry | undefined,
): ContextUsageData {
  return useMemo(() => {
    let lastContextUsedTokens: number | null = null;
    let lastOutputTokens: number | null = null;
    let lastContextWindowTokens: number | null = null;

    // Reverse-scan for last assistant message with token data.
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const contextUsedTokens = msg.contextUsedTokens ?? msg.inputTokens;
      if (msg.role === "assistant" && contextUsedTokens != null && lastContextUsedTokens === null) {
        lastContextUsedTokens = contextUsedTokens;
        lastOutputTokens = msg.outputTokens ?? null;
        lastContextWindowTokens = msg.contextWindowTokens ?? null;
        break;
      }
    }

    const contextWindow = lastContextWindowTokens ?? selectedModel?.contextWindow ?? null;
    const usageFraction =
      lastContextUsedTokens != null && contextWindow
        ? Math.min(1, lastContextUsedTokens / contextWindow)
        : null;

    return {
      inputTokens: lastContextUsedTokens,
      outputTokens: lastOutputTokens,
      contextWindow,
      usageFraction,
    };
  }, [messages, selectedModel]);
}
