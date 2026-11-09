export const MAX_AGENT_OUTPUT_CHARS = 128 * 1024;

type TextBlock = { type: "text"; text: string };

function isTextBlock(block: unknown): block is TextBlock {
  return !!block && typeof block === "object" && "type" in block && block.type === "text"
    && "text" in block && typeof block.text === "string";
}

/** Join provider content blocks into text, replacing inline image bytes with a placeholder. */
export function toolOutputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (output == null) return "";
  const blocks = Array.isArray(output) ? output : [output];
  return blocks.map((block: unknown) => {
    if (isTextBlock(block)) return block.text;
    if (block && typeof block === "object" && "type" in block && block.type === "image") {
      return "[Image output omitted from chat history.]";
    }
    return typeof block === "string" ? block : JSON.stringify(block);
  }).join("\n\n");
}

/** Tool results can contain provider content blocks, including inline image bytes. */
export function normalizeToolOutput(output: unknown): string {
  if (Array.isArray(output) && output.length > 0 && output.every(isTextBlock)) {
    // Clients render text-block JSON (sub-agent reports) as markdown; keep that shape when it fits.
    const serialized = JSON.stringify(output, null, 2);
    if (serialized.length <= MAX_AGENT_OUTPUT_CHARS) return serialized;
  }
  return boundAgentOutput(toolOutputText(output)) ?? "";
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
