import { useMemo } from "react";
import type { ChatMessage, ModelCatalogEntry } from "@/types";

export interface ContextUsageData {
  /** Last turn's input tokens (= current context window usage). */
  inputTokens: number | null;
  /** Total output tokens for last turn. */
  outputTokens: number | null;
  /** Context window size for the selected model. */
  contextWindow: number | null;
  /** Usage as a fraction 0–1. null if no data. */
  usageFraction: number | null;
  /** Cumulative session cost in USD. null if no cost data available. */
  sessionCostUsd: number | null;
}

export function useContextUsage(
  messages: ChatMessage[],
  selectedModel: ModelCatalogEntry | undefined,
): ContextUsageData {
  return useMemo(() => {
    let lastInputTokens: number | null = null;
    let lastOutputTokens: number | null = null;
    let totalCost: number | null = null;

    // Reverse-scan for last assistant message with token data
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "assistant" && msg.inputTokens != null && lastInputTokens === null) {
        lastInputTokens = msg.inputTokens;
        lastOutputTokens = msg.outputTokens ?? null;
        break;
      }
    }

    // Sum costUsd across all assistant messages
    for (const msg of messages) {
      if (msg.role === "assistant" && msg.costUsd != null) {
        totalCost = (totalCost ?? 0) + msg.costUsd;
      }
    }

    const contextWindow = selectedModel?.contextWindow ?? null;
    const usageFraction =
      lastInputTokens != null && contextWindow
        ? Math.min(1, lastInputTokens / contextWindow)
        : null;

    return {
      inputTokens: lastInputTokens,
      outputTokens: lastOutputTokens,
      contextWindow,
      usageFraction,
      sessionCostUsd: totalCost,
    };
  }, [messages, selectedModel]);
}
