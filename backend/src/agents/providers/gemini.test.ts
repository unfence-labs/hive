import { describe, it, expect } from "vitest";
import { GeminiProvider } from "./gemini.js";
import { GeminiStreamAdapter } from "./gemini-stream-adapter.js";
import type { ProviderSessionState } from "./types.js";

function baseSession(overrides?: Partial<ProviderSessionState>): ProviderSessionState {
  return {
    isFirstMessage: true,
    sessionId: "gemini-session-id",
    skipPermissions: true,
    ...overrides,
  };
}

describe("GeminiProvider", () => {
  const provider = new GeminiProvider();

  // ── Identity ───────────────────────────────────────────────────────

  it("has id 'gemini'", () => {
    expect(provider.id).toBe("gemini");
  });

  it("has command 'gemini'", () => {
    expect(provider.command).toBe("gemini");
  });

  // ── Models ─────────────────────────────────────────────────────────

  it("exposes a non-empty list of models", () => {
    expect(provider.models.length).toBeGreaterThan(0);
  });

  it("has exactly one default model", () => {
    const defaults = provider.models.filter((m) => m.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.id).toBe("gemini-2.5-pro");
  });

  it("includes Gemini 3 preview models marked as new", () => {
    const newModels = provider.models.filter((m) => m.isNew);
    expect(newModels.map((m) => m.id)).toEqual([
      "gemini-3-pro-preview",
      "gemini-3-flash-preview",
    ]);
  });

  // ── Capabilities ───────────────────────────────────────────────────

  it("does not expose thinking toggle", () => {
    expect(provider.capabilities.thinking).toBe(false);
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

  it("builds first-message args with prompt, output format, yolo, and model", () => {
    const args = provider.buildArgs(
      "Hello Gemini",
      { model: "gemini-2.5-flash" },
      baseSession({ isFirstMessage: true }),
    );

    expect(args).toContain("-p");
    expect(args).toContain("Hello Gemini");
    expect(args).toContain("-o");
    expect(args).toContain("stream-json");
    expect(args).toContain("-m");
    expect(args).toContain("gemini-2.5-flash");
    expect(args).toContain("-y");
    expect(args).not.toContain("-r");
  });

  it("omits model flag when model is unknown", () => {
    const args = provider.buildArgs("Hello Gemini", { model: "unknown-model" }, baseSession());
    expect(args).not.toContain("-m");
  });

  it("adds resume flag on subsequent messages", () => {
    const args = provider.buildArgs(
      "Continue",
      { model: "gemini-2.5-pro" },
      baseSession({ isFirstMessage: false, sessionId: "gem-sess-123" }),
    );

    const resumeIndex = args.indexOf("-r");
    expect(resumeIndex).toBeGreaterThanOrEqual(0);
    expect(args[resumeIndex + 1]).toBe("gem-sess-123");
  });

  it("passes prompt content as value of -p", () => {
    const args = provider.buildArgs("Prompt content", {}, baseSession());
    const promptIdx = args.indexOf("-p");
    expect(promptIdx).toBeGreaterThanOrEqual(0);
    expect(args[promptIdx + 1]).toBe("Prompt content");
  });

  // ── buildEnv ───────────────────────────────────────────────────────

  it("always returns undefined for env overrides", () => {
    expect(provider.buildEnv({})).toBeUndefined();
    expect(provider.buildEnv({ thinkingEnabled: true })).toBeUndefined();
    expect(provider.buildEnv({ planMode: true })).toBeUndefined();
  });

  // ── createStreamAdapter ────────────────────────────────────────────

  it("returns a GeminiStreamAdapter instance", () => {
    const adapter = provider.createStreamAdapter();
    expect(adapter).toBeInstanceOf(GeminiStreamAdapter);
  });
});
