import type { ChatMessage } from "@/types";

interface PendingToolLike {
  toolName: string;
}

export function hasExitPlanModeTool(message: Pick<ChatMessage, "toolCalls"> | undefined): boolean {
  return message?.toolCalls?.some((tool) => tool.name === "ExitPlanMode") === true;
}

export function hasPendingExitPlanModeInput(pendingToolInputs: PendingToolLike[]): boolean {
  return pendingToolInputs.some((input) => input.toolName === "ExitPlanMode");
}

export function getFallbackInteractiveAssistantIndex(
  messages: ChatMessage[],
  isStreaming: boolean,
): number {
  if (isStreaming) return -1;

  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant") {
      lastAssistantIdx = i;
      break;
    }
  }
  if (lastAssistantIdx < 0) return -1;

  const hasUserAfterLastAssistant = messages
    .slice(lastAssistantIdx + 1)
    .some((message) => message.role === "user");
  return hasUserAfterLastAssistant ? -1 : lastAssistantIdx;
}

export function isPlanAwaitingUserInput(params: {
  messages: ChatMessage[];
  isStreaming: boolean;
  pendingToolInputs: PendingToolLike[];
}): boolean {
  const { messages, isStreaming, pendingToolInputs } = params;
  if (hasPendingExitPlanModeInput(pendingToolInputs)) return true;

  const fallbackInteractiveIdx = getFallbackInteractiveAssistantIndex(messages, isStreaming);
  if (fallbackInteractiveIdx < 0) return false;
  return hasExitPlanModeTool(messages[fallbackInteractiveIdx]);
}
