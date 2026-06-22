import type { CompletionItem, CompletionItemType, CompletionSource } from "@/types";
import { fuzzyScore, FUZZY_SCORE } from "./fuzzy-match";

/**
 * Display/priority order for completion sources. Drives both the popup's
 * grouping and the relevance sort so keyboard navigation matches what's shown.
 */
export const COMPLETION_SOURCE_ORDER: CompletionSource[] = [
  "builtin",
  "user_command",
  "project_command",
  "user_skill",
  "project_skill",
  "admin_skill",
  "plugin",
  "user_agent",
  "project_agent",
];

export function completionSourceRank(source: CompletionSource): number {
  const index = COMPLETION_SOURCE_ORDER.indexOf(source);
  return index === -1 ? COMPLETION_SOURCE_ORDER.length : index;
}

/**
 * Filter completion items of `type` by `query` and rank them. Matching is by
 * substring over the command name only (exact > prefix > substring), so typing
 * "yyy" still surfaces "/xxx-yyy" while descriptions and loose subsequence
 * matches (e.g. "prd" hitting "improve-codebase-architecture") stay out of the
 * results. Results are ordered by source priority first (to stay aligned with
 * the popup's grouped layout and keyboard navigation) and by relevance within
 * each source. An empty query returns every item of the type in its original
 * order.
 */
export function filterCompletions(
  items: CompletionItem[],
  type: CompletionItemType,
  query: string,
): CompletionItem[] {
  const typed = items.filter((item) => item.type === type);
  if (query === "") return typed;

  return typed
    .map((item, index) => ({
      item,
      index,
      score: fuzzyScore(item.name, query),
    }))
    // Substring-or-better only: the loose subsequence tier surfaced unrelated
    // commands for short queries (e.g. "prd" → "improve-codebase-architecture").
    .filter((entry) => entry.score >= FUZZY_SCORE.substring)
    .sort(
      (a, b) =>
        completionSourceRank(a.item.source) - completionSourceRank(b.item.source) ||
        b.score - a.score ||
        a.index - b.index,
    )
    .map((entry) => entry.item);
}
