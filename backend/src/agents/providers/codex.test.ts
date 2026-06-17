import { describe, it, expect } from "vitest";
import { CodexProvider } from "./codex.js";

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

  it("includes gpt-5.5 as default", () => {
    const defaultModel = provider.models.find((m) => m.isDefault);
    expect(defaultModel?.id).toBe("gpt-5.5");
  });

  it("tracks the verified 400K context window for gpt-5.5", () => {
    const defaultModel = provider.models.find((m) => m.isDefault);
    expect(defaultModel?.contextWindow).toBe(400_000);
  });

  it("tracks the verified 400K context window for gpt-5.3-codex", () => {
    const legacyModel = provider.models.find((m) => m.id === "gpt-5.3-codex");
    expect(legacyModel?.contextWindow).toBe(400_000);
  });

  // ── Capabilities ───────────────────────────────────────────────────

  it("supports effort-level thinking control", () => {
    expect(provider.capabilities.thinkingLevels).toEqual([
      "none", "minimal", "low", "medium", "high", "xhigh",
    ]);
  });

  it("does not support plan mode", () => {
    expect(provider.capabilities.planMode).toBe(false);
  });

  it("does not support blocking tools", () => {
    expect(provider.capabilities.blockingTools).toBe(false);
  });

  it("supports provider-specific completions", () => {
    expect(provider.capabilities.completions).toBe(true);
  });

  it("supports goals", () => {
    expect(provider.capabilities.goals).toBe(true);
  });
});
