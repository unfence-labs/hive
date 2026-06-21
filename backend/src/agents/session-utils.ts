import type { ChatMessage, ToolCall } from "../types.js";
import type { AgentActivity } from "@hive/shared/agent-activity";
import { normalizeToolOutput, outputByteLength, outputLineCount } from "@hive/shared/agent-activity";

/** Parse a `messages.jsonl` blob into ChatMessages, skipping malformed lines. */
export function parseJsonlMessages(raw: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      messages.push(JSON.parse(line) as ChatMessage);
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

// ── History truncation (read-only) ──────────────────────────────────
//
// REST history is the single source of truth for finalized turns, where the
// cumulative payload weight lives (large file contents, command output, diffs).
// On read, each heavy string is replaced by a small preview plus cheap exact
// scalars and the full body is omitted; clients fetch the full body on expand.
//
// This transforms COPIES of the persisted objects only — disk stays the
// untouched source of truth (no persisted-format change, no migration). Live
// streaming is unaffected; only finalized history read from disk is truncated.

/** Preview cap for truncated outputs, in bytes. */
export const OUTPUT_PREVIEW_BYTES = 2048;

/** Scalars + preview computed for a heavy string field. */
export interface TruncatedField {
  preview: string;
  lineCount: number;
  byteLength: number;
  truncated: boolean;
}

/**
 * Slice a UTF-8 string to at most `maxBytes`, never splitting a multibyte char.
 * Walks back from the byte cap off any continuation bytes (`0b10xxxxxx`).
 */
function sliceUtf8(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf-8");
  if (buf.length <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0b1100_0000) === 0b1000_0000) end -= 1;
  return buf.toString("utf-8", 0, end);
}

/**
 * Compute the preview + scalars for a heavy string. Scalars are always derived
 * from the FULL text: line count ignores one trailing newline, byte length is
 * UTF-8 byte length, and the preview is the first {@link OUTPUT_PREVIEW_BYTES}
 * bytes.
 */
export function computeTruncatedField(full: string): TruncatedField {
  const byteLength = outputByteLength(full);
  const lineCount = outputLineCount(full);
  const truncated = byteLength > OUTPUT_PREVIEW_BYTES;
  return {
    preview: truncated ? sliceUtf8(full, OUTPUT_PREVIEW_BYTES) : full,
    lineCount,
    byteLength,
    truncated,
  };
}

/**
 * Apply truncation to a single tool call's `output`, returning a copy. When the
 * output exceeds the cap the full body is omitted; otherwise it is kept intact.
 * The scalars/preview are always set so clients have one rendering path and
 * never parse the body.
 */
function truncateToolCall(tool: ToolCall): ToolCall {
  if (tool.output === undefined) return tool;
  const output = normalizeToolOutput(tool.output);
  const field = computeTruncatedField(output);
  const next: ToolCall = {
    ...tool,
    output,
    outputPreview: field.preview,
    outputLineCount: field.lineCount,
    outputByteLength: field.byteLength,
    outputTruncated: field.truncated,
  };
  if (field.truncated) delete next.output;
  return next;
}

/**
 * Apply truncation to an activity's heavy string field, returning a copy. Only
 * `command_execution.output` carries a dominant heavy field (truncated to the
 * `output*` preview + scalars, mirroring the {@link ToolCall} sub-shape). All
 * other variants — including `file_change`, whose diffs are bounded by edit
 * size — pass through unchanged.
 */
function truncateActivity(activity: AgentActivity): AgentActivity {
  if (activity.kind !== "command_execution") return activity;
  if (activity.output === undefined) return activity;
  const output = normalizeToolOutput(activity.output);
  const field = computeTruncatedField(output);
  const next: Extract<AgentActivity, { kind: "command_execution" }> = {
    ...activity,
    output,
    outputPreview: field.preview,
    outputLineCount: field.lineCount,
    outputByteLength: field.byteLength,
    outputTruncated: field.truncated,
  };
  if (field.truncated) delete next.output;
  return next;
}

/**
 * Transform a persisted message into its REST-history form: every heavy tool /
 * activity output is truncated to preview + scalars and the full body omitted
 * when over the cap. Returns a copy; the input (and disk) are never mutated.
 */
export function truncateMessageForHistory(message: ChatMessage): ChatMessage {
  // Known limitation (see README "REST history payload weight"): only
  // ToolCall.output and command_execution.output are truncated; ToolCall.input
  // and file_change diffs pass through and can still be heavy.
  const next: ChatMessage = { ...message };
  if (message.toolCalls) next.toolCalls = message.toolCalls.map(truncateToolCall);
  if (message.agentActivities) {
    next.agentActivities = message.agentActivities.map(truncateActivity);
  }
  return next;
}

/**
 * Find the full, untruncated output for a truncated heavy field by id, scanning
 * a session's full (disk-read) messages. Each id maps 1:1 to a single body:
 *   - a {@link ToolCall} with `id === id` (its `output`)
 *   - a `command_execution` activity with `id === id` (its `output`)
 * Returns `undefined` when no heavy body is found for that id.
 */
export function findFullOutputById(messages: ChatMessage[], id: string): string | undefined {
  for (const message of messages) {
    for (const tool of message.toolCalls ?? []) {
      if (tool.id === id && tool.output !== undefined) return normalizeToolOutput(tool.output);
    }
    for (const activity of message.agentActivities ?? []) {
      if (activity.id !== id) continue;
      if (activity.kind === "command_execution" && activity.output !== undefined) {
        return normalizeToolOutput(activity.output);
      }
    }
  }
  return undefined;
}

/**
 * Slice the last `limit` messages, or the `limit` immediately before the
 * message whose id === `before` (exclusive). Returns the window plus `hasMore`,
 * which is true when older messages exist before `window[0]`.
 *
 * If `before` is given but its id is not found, the window is empty and
 * `hasMore` is false — an unknown cursor cannot point anywhere in history.
 */
export function selectMessageWindow(
  messages: ChatMessage[],
  limit: number,
  before?: string,
): { messages: ChatMessage[]; hasMore: boolean } {
  let end = messages.length;
  if (before !== undefined) {
    const idx = messages.findIndex((m) => m.id === before);
    if (idx === -1) return { messages: [], hasMore: false };
    end = idx;
  }
  const start = Math.max(0, end - limit);
  return { messages: messages.slice(start, end), hasMore: start > 0 };
}
