import { describe, it, expect } from "vitest";
import { CodexProvider } from "./codex.js";
import { findModel } from "./types.js";

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

  it("exposes the GPT-5.6 tiers and gpt-5.5", () => {
    expect(provider.models.map((m) => m.id)).toEqual([
      "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5",
    ]);
  });

  it("has gpt-5.6-sol as the only default model", () => {
    const defaults = provider.models.filter((m) => m.isDefault);
    expect(defaults.map((m) => m.id)).toEqual(["gpt-5.6-sol"]);
  });

  it("tracks the catalog context windows (372K for 5.6 tiers, 272K for 5.5)", () => {
    for (const id of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
      expect(provider.models.find((m) => m.id === id)?.contextWindow).toBe(372_000);
    }
    expect(provider.models.find((m) => m.id === "gpt-5.5")?.contextWindow).toBe(272_000);
  });

  it("aliases retired gpt-5.3-codex to gpt-5.6-sol", () => {
    expect(findModel(provider.models, "gpt-5.3-codex")?.id).toBe("gpt-5.6-sol");
  });

  // ── Capabilities ───────────────────────────────────────────────────

  it("supports effort-level thinking control as a baseline", () => {
    expect(provider.capabilities.thinkingLevels).toEqual([
      "low", "medium", "high", "xhigh",
    ]);
  });

  it("exposes per-model effort ceilings for the GPT-5.6 tiers", () => {
    const levels = (id: string) => provider.models.find((m) => m.id === id)?.thinkingLevels;
    expect(levels("gpt-5.6-sol")).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);
    expect(levels("gpt-5.6-terra")).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);
    expect(levels("gpt-5.6-luna")).toEqual(["low", "medium", "high", "xhigh", "max"]);
    // gpt-5.5 inherits the provider baseline.
    expect(levels("gpt-5.5")).toBeUndefined();
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
