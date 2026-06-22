export const MAX_AGENT_OUTPUT_CHARS = 128 * 1024;

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
