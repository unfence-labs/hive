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
