import { describe, it, expect } from "vitest";
import { CodexProvider } from "./codex.js";
import { CodexStreamAdapter } from "./codex-stream-adapter.js";
import type { ProviderSessionState } from "./types.js";

function baseSession(overrides?: Partial<ProviderSessionState>): ProviderSessionState {
  return {
    isFirstMessage: true,
    sessionId: "thread-abc",
    skipPermissions: true,
    ...overrides,
  };
}

describe("CodexProvider", () => {
  const provider = new CodexProvider();

  // ── Identity ───────────────────────────────────────────────────────

  it("has id 'codex'", () => {
    expect(provider.id).toBe("codex");
  });

  it("has command 'codex'", () => {
    expect(provider.command).toBe("codex");
  });

  // ── Models ─────────────────────────────────────────────────────────

  it("exposes a non-empty list of models", () => {
    expect(provider.models.length).toBeGreaterThan(0);
  });

  it("has exactly one default model", () => {
    const defaults = provider.models.filter((m) => m.isDefault);
    expect(defaults).toHaveLength(1);
  });

  it("includes gpt-5.4 as default", () => {
    const defaultModel = provider.models.find((m) => m.isDefault);
    expect(defaultModel?.id).toBe("gpt-5.4");
  });

  // ── Capabilities ───────────────────────────────────────────────────

  it("supports thinking levels", () => {
    expect(provider.capabilities.thinking).toBe("levels");
  });

  it("does not support plan mode", () => {
    expect(provider.capabilities.planMode).toBe(false);
  });

  it("does not support blocking tools", () => {
    expect(provider.capabilities.blockingTools).toBe(false);
  });

  it("does not support completions", () => {
    expect(provider.capabilities.completions).toBe(false);
  });

  // ── buildArgs ──────────────────────────────────────────────────────

  it("starts with 'exec' for first message", () => {
    const args = provider.buildArgs("Hello", {}, baseSession({ isFirstMessage: true }));
    expect(args[0]).toBe("exec");
    // First message should NOT have "resume"
    expect(args[1]).not.toBe("resume");
  });

  it("starts with 'exec resume' for subsequent messages", () => {
    const args = provider.buildArgs("Hello", {}, baseSession({ isFirstMessage: false }));
    expect(args[0]).toBe("exec");
    expect(args[1]).toBe("resume");
  });

  it("includes --json flag", () => {
    const args = provider.buildArgs("Hello", {}, baseSession());
    expect(args).toContain("--json");
  });

  it("includes --dangerously-bypass-approvals-and-sandbox flag", () => {
    const args = provider.buildArgs("Hello", {}, baseSession());
    expect(args).toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("includes --model with cli value when model is specified", () => {
    const args = provider.buildArgs("Hello", { model: "gpt-5.3-codex" }, baseSession());
    expect(args).toContain("--model");
    expect(args).toContain("gpt-5.3-codex");
  });

  it("omits --model when model is not in the list", () => {
    const args = provider.buildArgs("Hello", { model: "unknown" }, baseSession());
    expect(args).not.toContain("--model");
  });

  it("includes --config with default thinking level when none specified", () => {
    const args = provider.buildArgs("Hello", {}, baseSession());
    expect(args).toContain("--config");
    expect(args).toContain("model_reasoning_effort=high");
  });

  it("uses provided thinkingLevel", () => {
    const args = provider.buildArgs("Hello", { thinkingLevel: "low" }, baseSession());
    expect(args).toContain("model_reasoning_effort=low");
  });

  it("puts content as last positional arg on first message", () => {
    const args = provider.buildArgs("Do something", {}, baseSession({ isFirstMessage: true }));
    expect(args[args.length - 1]).toBe("Do something");
  });

  it("puts session ID and content as last args on resume", () => {
    const args = provider.buildArgs("Do something", {}, baseSession({ isFirstMessage: false, sessionId: "thread-xyz" }));
    expect(args[args.length - 2]).toBe("thread-xyz");
    expect(args[args.length - 1]).toBe("Do something");
  });

  it("does NOT use -p flag for content", () => {
    const args = provider.buildArgs("Hello", {}, baseSession());
    expect(args).not.toContain("-p");
    expect(args).not.toContain("--profile");
  });

  // ── buildEnv ───────────────────────────────────────────────────────

  it("always returns undefined (no env overrides)", () => {
    expect(provider.buildEnv({})).toBeUndefined();
    expect(provider.buildEnv({ thinkingEnabled: true })).toBeUndefined();
    expect(provider.buildEnv({ thinkingLevel: "xhigh" })).toBeUndefined();
  });

  // ── createStreamAdapter ────────────────────────────────────────────

  it("returns a CodexStreamAdapter instance", () => {
    const adapter = provider.createStreamAdapter();
    expect(adapter).toBeInstanceOf(CodexStreamAdapter);
  });

  it("returned adapter has write and flush methods", () => {
    const adapter = provider.createStreamAdapter();
    expect(typeof adapter.write).toBe("function");
    expect(typeof adapter.flush).toBe("function");
  });
});
