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
  id: "claude:opus-4-7",
  label: "Opus 4.7",
  provider: "claude",
  providerLabel: "Claude Code",
  capabilities: { thinkingLevels: ["low", "medium", "high", "xhigh", "max"], planMode: true, blockingTools: true, completions: true },
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

  // ── Regression tests: context display accuracy ────────────────────────

  it("shows last turn context, not accumulated total across turns", () => {
    // Each turn re-sends the full conversation, so each message's inputTokens
    // represents the context window usage for that turn (growing over time).
    const messages: ChatMessage[] = [
      makeMessage({ role: "user", content: "Hello" }),
      makeMessage({ role: "assistant", content: "Hi", inputTokens: 10_000, outputTokens: 100 }),
      makeMessage({ role: "user", content: "Tell me more" }),
      makeMessage({ role: "assistant", content: "Sure", inputTokens: 25_000, outputTokens: 200 }),
      makeMessage({ role: "user", content: "And more" }),
      makeMessage({ role: "assistant", content: "Done", inputTokens: 45_000, outputTokens: 300 }),
    ];
    const { result } = renderHook(() => useContextUsage(messages, claudeModel));
    // Must show the LAST turn's context (45K), not cumulative (10+25+45=80K)
    expect(result.current.inputTokens).toBe(45_000);
    expect(result.current.usageFraction).toBeCloseTo(0.225); // 45k / 200k
  });

  it("ignores user messages entirely when scanning for token data", () => {
    const messages: ChatMessage[] = [
      makeMessage({ role: "assistant", content: "Reply", inputTokens: 30_000, outputTokens: 200 }),
      makeMessage({ role: "user", content: "Follow-up" }),
    ];
    const { result } = renderHook(() => useContextUsage(messages, claudeModel));
    expect(result.current.inputTokens).toBe(30_000);
  });

  it("handles inputTokens of 0 as valid data", () => {
    const messages: ChatMessage[] = [
      makeMessage({ role: "assistant", content: "Reply", inputTokens: 0, outputTokens: 0 }),
    ];
    const { result } = renderHook(() => useContextUsage(messages, claudeModel));
    expect(result.current.inputTokens).toBe(0);
    expect(result.current.usageFraction).toBe(0);
  });

  it("returns correct fraction near compaction threshold (~83%)", () => {
    const messages: ChatMessage[] = [
      makeMessage({ role: "assistant", content: "Reply", inputTokens: 167_000, outputTokens: 500 }),
    ];
    const { result } = renderHook(() => useContextUsage(messages, claudeModel));
    expect(result.current.usageFraction).toBeCloseTo(0.835); // 167k / 200k
  });

  it("handles context dropping after compaction (tokens decrease between turns)", () => {
    // After compaction the context shrinks — the last turn should show the lower value
    const messages: ChatMessage[] = [
      makeMessage({ role: "user", content: "Hello" }),
      makeMessage({ role: "assistant", content: "Long reply", inputTokens: 170_000, outputTokens: 2000 }),
      makeMessage({ role: "user", content: "More" }),
      // After compaction, context is summarized — much smaller
      makeMessage({ role: "assistant", content: "Compacted reply", inputTokens: 40_000, outputTokens: 500 }),
    ];
    const { result } = renderHook(() => useContextUsage(messages, claudeModel));
    expect(result.current.inputTokens).toBe(40_000);
    expect(result.current.usageFraction).toBe(0.2); // 40k / 200k
  });

  it("skips multiple trailing assistant messages without tokens", () => {
    const messages: ChatMessage[] = [
      makeMessage({ role: "assistant", content: "With tokens", inputTokens: 60_000, outputTokens: 300 }),
      makeMessage({ role: "assistant", content: "No tokens 1" }),
      makeMessage({ role: "assistant", content: "No tokens 2" }),
      makeMessage({ role: "assistant", content: "No tokens 3" }),
    ];
    const { result } = renderHook(() => useContextUsage(messages, claudeModel));
    expect(result.current.inputTokens).toBe(60_000);
  });

  it("handles assistant message with inputTokens but no outputTokens", () => {
    const messages: ChatMessage[] = [
      makeMessage({ role: "assistant", content: "Reply", inputTokens: 80_000 }),
    ];
    const { result } = renderHook(() => useContextUsage(messages, claudeModel));
    expect(result.current.inputTokens).toBe(80_000);
    expect(result.current.outputTokens).toBeNull();
    expect(result.current.usageFraction).toBe(0.4);
  });

  it("works with different context window sizes (1M extended)", () => {
    const extendedModel: ModelCatalogEntry = {
      ...claudeModel,
      contextWindow: 1_000_000,
    };
    const messages: ChatMessage[] = [
      makeMessage({ role: "assistant", content: "Reply", inputTokens: 400_000, outputTokens: 1000 }),
    ];
    const { result } = renderHook(() => useContextUsage(messages, extendedModel));
    expect(result.current.inputTokens).toBe(400_000);
    expect(result.current.contextWindow).toBe(1_000_000);
    expect(result.current.usageFraction).toBe(0.4); // 400k / 1M
  });

  it("single-message conversation returns correct usage", () => {
    const messages: ChatMessage[] = [
      makeMessage({ role: "assistant", content: "First reply", inputTokens: 8_000, outputTokens: 200 }),
    ];
    const { result } = renderHook(() => useContextUsage(messages, claudeModel));
    expect(result.current.inputTokens).toBe(8_000);
    expect(result.current.outputTokens).toBe(200);
    expect(result.current.usageFraction).toBe(0.04);
  });

  it("long conversation: always reads the most recent assistant with tokens", () => {
    const messages: ChatMessage[] = [];
    // Build a 20-turn conversation where each turn grows context
    for (let i = 0; i < 20; i++) {
      messages.push(makeMessage({ role: "user", content: `Turn ${i}` }));
      messages.push(
        makeMessage({
          role: "assistant",
          content: `Reply ${i}`,
          inputTokens: (i + 1) * 8_000,
          outputTokens: (i + 1) * 50,
        }),
      );
    }
    const { result } = renderHook(() => useContextUsage(messages, claudeModel));
    // Last turn: i=19, inputTokens = 20 * 8000 = 160_000
    expect(result.current.inputTokens).toBe(160_000);
    expect(result.current.outputTokens).toBe(1_000);
    expect(result.current.usageFraction).toBe(0.8);
  });

  it("only user messages: returns all nulls for tokens", () => {
    const messages: ChatMessage[] = [
      makeMessage({ role: "user", content: "Hello" }),
      makeMessage({ role: "user", content: "Anyone?" }),
    ];
    const { result } = renderHook(() => useContextUsage(messages, claudeModel));
    expect(result.current.inputTokens).toBeNull();
    expect(result.current.outputTokens).toBeNull();
    expect(result.current.usageFraction).toBeNull();
  });

  it("exact boundary: inputTokens equals contextWindow gives fraction 1.0", () => {
    const messages: ChatMessage[] = [
      makeMessage({ role: "assistant", content: "Reply", inputTokens: 200_000, outputTokens: 500 }),
    ];
    const { result } = renderHook(() => useContextUsage(messages, claudeModel));
    expect(result.current.usageFraction).toBe(1.0);
  });
});
