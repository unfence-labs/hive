import type { ChatMessage } from "../types.js";

/**
 * Extract the "## Summary" section from the last assistant message.
 * Returns the text between "## Summary" and the next heading or end of message.
 */
export function extractSummary(messages: ChatMessage[]): string | undefined {
  // Find the last assistant message
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      return extractSummaryFromText(messages[i].content);
    }
  }
  return undefined;
}

export function extractSummaryFromText(text: string): string | undefined {
  const match = text.match(/## Summary[ \t]*\n([\s\S]*?)(?=\n## |\n# |$)/);
  if (!match) return undefined;
  const trimmed = match[1].trim();
  return trimmed || undefined;
}

/**
 * Fallback preview: return the first `maxLen` characters of the last
 * assistant message content (trimmed). Used when no structured
 * "## Summary" section is present.
 */
export function extractPreview(
  messages: ChatMessage[],
  maxLen = 500,
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      const text = messages[i].content.trim();
      if (!text) continue;
      if (text.length <= maxLen) return text;
      return text.slice(0, maxLen) + "…";
    }
  }
  return undefined;
}
