import { describe, it, expect } from "vitest";
import { ClaudeProvider } from "./claude.js";
import { StreamParser } from "../stream-parser.js";
import type { ProviderSessionState } from "./types.js";

function baseSession(overrides?: Partial<ProviderSessionState>): ProviderSessionState {
  return {
    isFirstMessage: true,
    sessionId: "test-session-id",
    skipPermissions: true,
    ...overrides,
  };
}

describe("ClaudeProvider", () => {
  const provider = new ClaudeProvider();

  // ── Identity ───────────────────────────────────────────────────────

  it("has id 'claude'", () => {
    expect(provider.id).toBe("claude");
  });

  it("has command 'claude'", () => {
    expect(provider.command).toBe("claude");
  });

  // ── Models ─────────────────────────────────────────────────────────

  it("exposes a non-empty list of models", () => {
    expect(provider.models.length).toBeGreaterThan(0);
  });

  it("has exactly one default model", () => {
    const defaults = provider.models.filter((m) => m.isDefault);
    expect(defaults).toHaveLength(1);
  });

  it("includes opus, sonnet, and haiku", () => {
    const ids = provider.models.map((m) => m.id);
    expect(ids).toContain("opus-4-7");
    expect(ids).toContain("sonnet-4-6");
    expect(ids).toContain("haiku-4-5");
  });

  it("maps each model to a cli value", () => {
    for (const model of provider.models) {
      expect(model.cliValue).toBeTruthy();
    }
  });

  // ── Capabilities ───────────────────────────────────────────────────

  it("supports effort-level thinking control", () => {
    expect(provider.capabilities.thinking).toBe(true);
  });

  it("supports plan mode", () => {
    expect(provider.capabilities.planMode).toBe(true);
  });

  it("supports blocking tools", () => {
    expect(provider.capabilities.blockingTools).toBe(true);
  });

  it("supports completions", () => {
    expect(provider.capabilities.completions).toBe(true);
  });

  // ── buildArgs ──────────────────────────────────────────────────────

  it("includes --print and --output-format stream-json", () => {
    const args = provider.buildArgs("Hello", {}, baseSession());
    expect(args).toContain("--print");
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
  });

  it("includes --verbose", () => {
    const args = provider.buildArgs("Hello", {}, baseSession());
    expect(args).toContain("--verbose");
  });

  it("uses --session-id on first message", () => {
    const args = provider.buildArgs("Hello", {}, baseSession({ isFirstMessage: true }));
    expect(args).toContain("--session-id");
    expect(args).toContain("test-session-id");
    expect(args).not.toContain("--resume");
  });

  it("uses --resume on subsequent messages", () => {
    const args = provider.buildArgs("Hello", {}, baseSession({ isFirstMessage: false }));
    expect(args).toContain("--resume");
    expect(args).toContain("test-session-id");
    expect(args).not.toContain("--session-id");
  });

  it("adds --model with cli value when model is specified", () => {
    const args = provider.buildArgs("Hello", { model: "sonnet-4-6" }, baseSession());
    expect(args).toContain("--model");
    expect(args).toContain("claude-sonnet-4-6");
  });

  it("omits --model when model is not in the list", () => {
    const args = provider.buildArgs("Hello", { model: "unknown-model" }, baseSession());
    expect(args).not.toContain("--model");
  });

  it("omits --model when no model specified", () => {
    const args = provider.buildArgs("Hello", {}, baseSession());
    expect(args).not.toContain("--model");
  });

  it("adds --dangerously-skip-permissions when skipPermissions is true and no planMode", () => {
    const args = provider.buildArgs("Hello", {}, baseSession({ skipPermissions: true }));
    expect(args).toContain("--dangerously-skip-permissions");
  });

  it("omits --dangerously-skip-permissions when skipPermissions is false", () => {
    const args = provider.buildArgs("Hello", {}, baseSession({ skipPermissions: false }));
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  it("uses --permission-mode plan instead of skip when planMode is true", () => {
    const args = provider.buildArgs("Hello", { planMode: true }, baseSession({ skipPermissions: true }));
    expect(args).toContain("--permission-mode");
    expect(args).toContain("plan");
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  it("adds --append-system-prompt on first message with systemPrompt", () => {
    const args = provider.buildArgs("Hello", {}, baseSession({
      isFirstMessage: true,
      systemPrompt: "Be helpful",
    }));
    expect(args).toContain("--append-system-prompt");
    expect(args).toContain("Be helpful");
  });

  it("omits --append-system-prompt on subsequent messages", () => {
    const args = provider.buildArgs("Hello", {}, baseSession({
      isFirstMessage: false,
      systemPrompt: "Be helpful",
    }));
    expect(args).not.toContain("--append-system-prompt");
  });

  it("omits --append-system-prompt when no systemPrompt", () => {
    const args = provider.buildArgs("Hello", {}, baseSession({ isFirstMessage: true }));
    expect(args).not.toContain("--append-system-prompt");
  });

  it("ends with -p and the content", () => {
    const args = provider.buildArgs("My message", {}, baseSession());
    expect(args.slice(-2)).toEqual(["-p", "My message"]);
  });

  // ── --effort flag ──────────────────────────────────────────────────

  it("adds --effort with the thinking level when provided", () => {
    const args = provider.buildArgs("Hello", { thinkingLevel: "high" }, baseSession());
    expect(args).toContain("--effort");
    expect(args).toContain("high");
  });

  it("passes each effort level through unchanged", () => {
    for (const level of ["low", "medium", "high", "xhigh"] as const) {
      const args = provider.buildArgs("Hi", { thinkingLevel: level }, baseSession());
      const idx = args.indexOf("--effort");
      expect(args[idx + 1]).toBe(level);
    }
  });

  it("omits --effort when thinkingLevel is not provided", () => {
    const args = provider.buildArgs("Hello", {}, baseSession());
    expect(args).not.toContain("--effort");
  });

  // ── buildEnv ───────────────────────────────────────────────────────

  it("always includes CLAUDE_CODE_ENABLE_TASKS", () => {
    const env = provider.buildEnv({});
    expect(env.CLAUDE_CODE_ENABLE_TASKS).toBe("true");
  });

  it("does not leak MAX_THINKING_TOKENS env var", () => {
    expect(provider.buildEnv({ thinkingLevel: "high" }).MAX_THINKING_TOKENS).toBeUndefined();
    expect(provider.buildEnv({ thinkingLevel: "low" }).MAX_THINKING_TOKENS).toBeUndefined();
  });

  // ── createStreamAdapter ────────────────────────────────────────────

  it("returns a StreamParser instance", () => {
    const adapter = provider.createStreamAdapter();
    expect(adapter).toBeInstanceOf(StreamParser);
  });

  it("returned adapter has write and flush methods", () => {
    const adapter = provider.createStreamAdapter();
    expect(typeof adapter.write).toBe("function");
    expect(typeof adapter.flush).toBe("function");
  });
});
