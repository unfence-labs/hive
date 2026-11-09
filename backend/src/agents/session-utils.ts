import type { ChatMessage } from "../types.js";
import { normalizeToolOutput } from "./bounded-output.js";

/** Parse a `messages.jsonl` blob into ChatMessages, skipping malformed lines. */
export function parseJsonlMessages(raw: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const message = JSON.parse(line) as ChatMessage;
      // Older transcripts persisted raw provider image blocks in tool outputs.
      // Normalize only the response; leave the original transcript on disk intact.
      for (const tool of message.toolCalls ?? []) {
        if (tool.output !== undefined) tool.output = normalizeToolOutput(tool.output);
      }
      messages.push(message);
    } catch {
      // Skip malformed lines to preserve recoverability.
    }
  }
  return messages;
}

/** Sort items by their `updatedAt` ISO timestamp, newest first; invalid dates sort last. */
export function sortByUpdatedAtDesc<T extends { updatedAt: string }>(items: T[]): T[] {
  return items.sort((a, b) => {
    const aTime = new Date(a.updatedAt).getTime() || 0;
    const bTime = new Date(b.updatedAt).getTime() || 0;
    return bTime - aTime;
  });
}
