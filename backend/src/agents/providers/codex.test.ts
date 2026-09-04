import { describe, it, expect } from "vitest";
import { CodexProvider, codexPersonalityFromOutputStyle } from "./codex.js";
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

  it("exposes the Codex 0.153 model catalog", () => {
    expect(provider.models.map((m) => m.id)).toEqual([
      "gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna",
      "gpt-5.3-codex-spark", "gpt-5.5",
    ]);
  });

  it("has gpt-5.6-sol as the only default model", () => {
    const defaults = provider.models.filter((m) => m.isDefault);
    expect(defaults.map((m) => m.id)).toEqual(["gpt-5.6-sol"]);
  });

  it("tracks the catalog context windows", () => {
    for (const id of ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"]) {
      expect(provider.models.find((m) => m.id === id)?.contextWindow).toBe(272_000);
    }
    expect(provider.models.find((m) => m.id === "gpt-5.3-codex-spark")?.contextWindow)
      .toBe(128_000);
  });

  it("aliases retired models to their catalog replacements", () => {
    expect(findModel(provider.models, "gpt-5.3-codex")?.id).toBe("gpt-5.6-sol");
    expect(findModel(provider.models, "gpt-5.4")?.id).toBe("gpt-5.6-terra");
    expect(findModel(provider.models, "gpt-5.4-mini")?.id).toBe("gpt-5.6-luna");
  });

  // ── Capabilities ───────────────────────────────────────────────────

  it("supports effort-level thinking control as a baseline", () => {
    expect(provider.capabilities.thinkingLevels).toEqual([
      "low", "medium", "high", "xhigh",
    ]);
  });

  it("exposes per-model effort ceilings for Astra and the GPT-5.6 tiers", () => {
    const levels = (id: string) => provider.models.find((m) => m.id === id)?.thinkingLevels;
    expect(levels("gpt-6-astra")).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);
    expect(levels("gpt-5.6-sol")).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);
    expect(levels("gpt-5.6-terra")).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);
    expect(levels("gpt-5.6-luna")).toEqual(["low", "medium", "high", "xhigh", "max"]);
    // Codex Spark and GPT-5.5 inherit the provider baseline.
    expect(levels("gpt-5.3-codex-spark")).toBeUndefined();
    expect(levels("gpt-5.5")).toBeUndefined();
  });

  it("exposes native personalities only for gpt-5.5", () => {
    expect(provider.models.find((model) => model.id === "gpt-5.5")?.outputStyles)
      .toEqual(["default", "friendly", "pragmatic", "none"]);
    for (const id of [
      "gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.3-codex-spark",
    ]) {
      expect(provider.models.find((model) => model.id === id)?.outputStyles).toBeUndefined();
    }
  });

  it("maps non-default styles to Codex personalities", () => {
    expect(codexPersonalityFromOutputStyle("friendly")).toBe("friendly");
    expect(codexPersonalityFromOutputStyle("pragmatic")).toBe("pragmatic");
    expect(codexPersonalityFromOutputStyle("none")).toBe("none");
    expect(codexPersonalityFromOutputStyle("default")).toBeUndefined();
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
