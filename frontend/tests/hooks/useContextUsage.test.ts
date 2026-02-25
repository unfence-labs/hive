import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useContextUsage } from "@/hooks/useContextUsage";
import type { ChatMessage, ModelCatalogEntry } from "@/types";

function makeMessage(overrides: Partial<ChatMessage> & { role: ChatMessage["role"] }): ChatMessage {
  return {
    id: Math.random().toString(36).slice(2),
    sessionId: "sess-1",
    content: "",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

const claudeModel: ModelCatalogEntry = {
  id: "claude:opus-4-6",
  label: "Opus 4.6",
  provider: "claude",
  providerLabel: "Claude Code",
  capabilities: { thinking: true, planMode: true, blockingTools: true, completions: true },
  contextWindow: 200_000,
};

describe("useContextUsage", () => {
  it("returns all nulls when there are no messages", () => {
    const { result } = renderHook(() => useContextUsage([], claudeModel));
    expect(result.current).toEqual({
      inputTokens: null,
      outputTokens: null,
      contextWindow: 200_000,
      usageFraction: null,
    });
  });

  it("returns all nulls when messages have no token data", () => {
    const messages: ChatMessage[] = [
      makeMessage({ role: "user", content: "Hello" }),
      makeMessage({ role: "assistant", content: "Hi back" }),
    ];
    const { result } = renderHook(() => useContextUsage(messages, claudeModel));
    expect(result.current.inputTokens).toBeNull();
    expect(result.current.usageFraction).toBeNull();
  });

  it("picks up token data from the last assistant message", () => {
    const messages: ChatMessage[] = [
      makeMessage({ role: "user", content: "Hello" }),
      makeMessage({ role: "assistant", content: "First", inputTokens: 10_000, outputTokens: 500 }),
      makeMessage({ role: "user", content: "More" }),
      makeMessage({ role: "assistant", content: "Second", inputTokens: 50_000, outputTokens: 1_200 }),
    ];
    const { result } = renderHook(() => useContextUsage(messages, claudeModel));
    expect(result.current.inputTokens).toBe(50_000);
    expect(result.current.outputTokens).toBe(1_200);
    expect(result.current.usageFraction).toBe(0.25); // 50k / 200k
  });

  it("skips assistant messages without token data", () => {
    const messages: ChatMessage[] = [
      makeMessage({ role: "assistant", content: "With tokens", inputTokens: 30_000, outputTokens: 200 }),
      makeMessage({ role: "assistant", content: "No tokens" }),
    ];
    const { result } = renderHook(() => useContextUsage(messages, claudeModel));
    // Should find the first one with tokens (reverse scan: second msg has no tokens, first does)
    expect(result.current.inputTokens).toBe(30_000);
  });

  it("computes usageFraction correctly", () => {
    const messages: ChatMessage[] = [
      makeMessage({ role: "assistant", content: "Reply", inputTokens: 160_000, outputTokens: 800 }),
    ];
    const { result } = renderHook(() => useContextUsage(messages, claudeModel));
    expect(result.current.usageFraction).toBe(0.8); // 160k / 200k
  });

  it("caps usageFraction at 1.0", () => {
    const messages: ChatMessage[] = [
      makeMessage({ role: "assistant", content: "Reply", inputTokens: 250_000, outputTokens: 800 }),
    ];
    const { result } = renderHook(() => useContextUsage(messages, claudeModel));
    expect(result.current.usageFraction).toBe(1.0);
  });

  it("returns null usageFraction when model has no contextWindow", () => {
    const modelNoCtx: ModelCatalogEntry = {
      ...claudeModel,
      contextWindow: undefined,
    };
    const messages: ChatMessage[] = [
      makeMessage({ role: "assistant", content: "Reply", inputTokens: 50_000, outputTokens: 100 }),
    ];
    const { result } = renderHook(() => useContextUsage(messages, modelNoCtx));
    expect(result.current.inputTokens).toBe(50_000);
    expect(result.current.contextWindow).toBeNull();
    expect(result.current.usageFraction).toBeNull();
  });

  it("returns null usageFraction when no model is selected", () => {
    const messages: ChatMessage[] = [
      makeMessage({ role: "assistant", content: "Reply", inputTokens: 50_000, outputTokens: 100 }),
    ];
    const { result } = renderHook(() => useContextUsage(messages, undefined));
    expect(result.current.inputTokens).toBe(50_000);
    expect(result.current.contextWindow).toBeNull();
    expect(result.current.usageFraction).toBeNull();
  });
});
