import { describe, expect, it } from "vitest";
import {
  getFallbackInteractiveAssistantIndex,
  hasExitPlanModeTool,
  hasPendingExitPlanModeInput,
  isPlanAwaitingUserInput,
} from "@/lib/plan-state";
import type { ChatMessage } from "@/types";

function userMessage(id: string): ChatMessage {
  return {
    id,
    sessionId: "sess-1",
    role: "user",
    content: "hello",
    timestamp: "2026-02-20T00:00:00.000Z",
  };
}

function assistantMessage(id: string, withPlanTool = false): ChatMessage {
  return {
    id,
    sessionId: "sess-1",
    role: "assistant",
    content: "response",
    timestamp: "2026-02-20T00:00:01.000Z",
    toolCalls: withPlanTool
      ? [{ id: "tool-plan", name: "ExitPlanMode", input: "{}" }]
      : undefined,
  };
}

describe("plan-state helpers", () => {
  it("detects ExitPlanMode tool calls", () => {
    expect(hasExitPlanModeTool(assistantMessage("a1", true))).toBe(true);
    expect(hasExitPlanModeTool(assistantMessage("a2", false))).toBe(false);
    expect(hasExitPlanModeTool(undefined)).toBe(false);
  });

  it("detects explicit pending ExitPlanMode inputs", () => {
    expect(hasPendingExitPlanModeInput([{ toolName: "AskUserQuestion" }])).toBe(false);
    expect(hasPendingExitPlanModeInput([{ toolName: "ExitPlanMode" }])).toBe(true);
  });

  it("returns -1 for fallback interactive assistant index while streaming", () => {
    const idx = getFallbackInteractiveAssistantIndex([assistantMessage("a1", true)], true);
    expect(idx).toBe(-1);
  });

  it("returns last assistant index when no user message comes after it", () => {
    const messages = [userMessage("u1"), assistantMessage("a1", false), assistantMessage("a2", true)];
    const idx = getFallbackInteractiveAssistantIndex(messages, false);
    expect(idx).toBe(2);
  });

  it("returns -1 when a user message appears after the last assistant", () => {
    const messages = [assistantMessage("a1", true), userMessage("u1")];
    const idx = getFallbackInteractiveAssistantIndex(messages, false);
    expect(idx).toBe(-1);
  });

  it("considers plan pending when explicit ExitPlanMode input exists", () => {
    const pending = isPlanAwaitingUserInput({
      messages: [assistantMessage("a1", false)],
      isStreaming: true,
      pendingToolInputs: [{ toolName: "ExitPlanMode" }],
    });
    expect(pending).toBe(true);
  });

  it("falls back to last interactive assistant plan tool when no pending input exists", () => {
    const pending = isPlanAwaitingUserInput({
      messages: [userMessage("u1"), assistantMessage("a1", true)],
      isStreaming: false,
      pendingToolInputs: [],
    });
    expect(pending).toBe(true);
  });

  it("returns false when there is no pending input and no interactive plan tool", () => {
    const pending = isPlanAwaitingUserInput({
      messages: [assistantMessage("a1", false)],
      isStreaming: false,
      pendingToolInputs: [],
    });
    expect(pending).toBe(false);
  });
});
