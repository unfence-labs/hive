export const MAX_AGENT_OUTPUT_CHARS = 128 * 1024;

/** Tool results can contain provider content blocks, including inline image bytes. */
export function normalizeToolOutput(output: unknown): string {
  if (typeof output === "string") return boundAgentOutput(output) ?? "";
  if (output == null) return "";
  const blocks = Array.isArray(output) ? output : [output];
  const text = blocks.map((block: unknown) => {
    if (block && typeof block === "object" && "type" in block) {
      if (block.type === "text" && "text" in block && typeof block.text === "string") {
        return block.text;
      }
      if (block.type === "image") {
        return "[Image output omitted from chat history.]";
      }
    }
    return typeof block === "string" ? block : JSON.stringify(block);
  }).join("\n\n");
  return boundAgentOutput(text) ?? "";
}

function truncationPrefix(): string {
  return "[Output truncated by Hive; showing the tail.]\n";
}

export function boundAgentOutput(output: string | undefined, maxChars = MAX_AGENT_OUTPUT_CHARS): string | undefined {
  if (output === undefined || output.length <= maxChars) return output;
  const prefix = truncationPrefix();
  const tailLength = Math.max(0, maxChars - prefix.length);
  return `${prefix}${output.slice(-tailLength)}`;
}

export function appendBoundedAgentOutput(
  current: string | undefined,
  delta: string,
  maxChars = MAX_AGENT_OUTPUT_CHARS,
): string {
  return boundAgentOutput(`${current ?? ""}${delta}`, maxChars) ?? "";
}
