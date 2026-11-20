import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { KimiProvider } from "./kimi.js";
import { findModel, type ProviderSessionState } from "./types.js";
import { StreamParser } from "../stream-parser.js";
import { loadConfig, updateConfig } from "../../state/config.js";
import { createTempDir } from "../../utils/test-helpers.js";

function baseSession(overrides?: Partial<ProviderSessionState>): ProviderSessionState {
  return {
    isFirstMessage: true,
    sessionId: "test-session-id",
    skipPermissions: true,
    ...overrides,
  };
}

let tempDir: string;

beforeEach(async () => {
  tempDir = await createTempDir("hive-kimi-provider-");
  // Warm the module-level key cache from an empty config (key = "").
  await loadConfig(tempDir);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("KimiProvider", () => {
  const provider = new KimiProvider();

  // ── Identity ───────────────────────────────────────────────────────

  it("has id 'kimi' but runs the claude CLI", () => {
    expect(provider.id).toBe("kimi");
    expect(provider.command).toBe("claude");
  });

  // ── Models ─────────────────────────────────────────────────────────

  it("exposes the static Kimi Code catalog", () => {
    expect(provider.models.map((m) => [m.id, m.label])).toEqual([
      ["k3.1-pro", "K3.1 Pro"],
      ["k3.1-pro-1m", "K3.1 Pro 1M"],
      ["k3.1-pro-highspeed", "K3.1 Pro Highspeed"],
      ["kimi-for-coding", "K2.8 Preview"],
      ["kimi-for-coding-highspeed", "K2.7 Coding Highspeed"],
    ]);
    const defaults = provider.models.filter((m) => m.isDefault);
    expect(defaults.map((m) => m.id)).toEqual(["k3.1-pro"]);
  });

  it("aliases retired K3 selections to K3.1 Pro", () => {
    expect(findModel(provider.models, "k3")?.id).toBe("k3.1-pro");
    expect(findModel(provider.models, "k3-1m")?.id).toBe("k3.1-pro-1m");
  });

  it("maps models to their cli values and context windows", () => {
    const byId = new Map(provider.models.map((m) => [m.id, m]));
    expect(byId.get("k3.1-pro")?.cliValue).toBe("k3.1-pro");
    expect(byId.get("k3.1-pro")?.contextWindow).toBe(262_144);
    expect(byId.get("k3.1-pro-1m")?.cliValue).toBe("k3.1-pro[1m]");
    expect(byId.get("k3.1-pro-1m")?.contextWindow).toBe(1_048_576);
    expect(byId.get("k3.1-pro-highspeed")?.cliValue).toBe("k3.1-pro-highspeed[1m]");
    expect(byId.get("k3.1-pro-highspeed")?.contextWindow).toBe(1_048_576);
    expect(byId.get("kimi-for-coding")?.cliValue).toBe("kimi-for-coding");
    expect(byId.get("kimi-for-coding")?.contextWindow).toBe(262_144);
    expect(byId.get("kimi-for-coding-highspeed")?.cliValue).toBe("kimi-for-coding-highspeed");
    expect(byId.get("kimi-for-coding-highspeed")?.contextWindow).toBe(262_144);
  });

  it("has no fast-mode model", () => {
    expect(provider.models.every((m) => !m.supportsFastMode)).toBe(true);
  });

  // ── Capabilities ───────────────────────────────────────────────────

  it("keeps provider capabilities level-less for models without an override", () => {
    expect(provider.capabilities).toEqual({
      thinkingLevels: [],
      planMode: true,
      blockingTools: true,
      completions: true,
      goals: false,
      outputStyles: ["default", "proactive", "concise", "explanatory", "learning"],
    });
  });

  it("applies native output styles through Claude Code settings", () => {
    const args = provider.buildArgs("Hello", { model: "k3", outputStyle: "learning" }, baseSession());
    const settingsIndex = args.indexOf("--settings");
    expect(JSON.parse(args[settingsIndex + 1])).toEqual({ outputStyle: "Learning" });
  });

  // ── buildArgs (inherited from ClaudeProvider) ──────────────────────

  it("builds claude print args with --model k3.1-pro and no implicit --effort", () => {
    const args = provider.buildArgs("Hello", { model: "k3.1-pro" }, baseSession());
    expect(args).toContain("--print");
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
    expect(args[args.indexOf("--name") + 1]).toBe("hive-test-session-id");
    const idx = args.indexOf("--model");
    expect(args[idx + 1]).toBe("k3.1-pro");
    expect(args).not.toContain("--effort");
    expect(args.slice(-2)).toEqual(["-p", "Hello"]);
  });

  it("passes k3.1-pro[1m] as the cli value for k3.1-pro-1m", () => {
    const args = provider.buildArgs("Hello", { model: "k3.1-pro-1m" }, baseSession());
    const idx = args.indexOf("--model");
    expect(args[idx + 1]).toBe("k3.1-pro[1m]");
  });

  it("passes supported effort levels to the CLI", () => {
    for (const thinkingLevel of ["low", "high", "max"] as const) {
      const args = provider.buildArgs("Hello", { model: "k3.1-pro", thinkingLevel }, baseSession());
      const effortIndex = args.indexOf("--effort");
      expect(args[effortIndex + 1]).toBe(thinkingLevel);
    }
  });

  it("drops unsupported or K2.7 effort levels", () => {
    expect(provider.buildArgs(
      "Hello",
      { model: "k3.1-pro", thinkingLevel: "medium" },
      baseSession(),
    )).not.toContain("--effort");
    expect(provider.buildArgs(
      "Hello",
      { model: "kimi-for-coding-highspeed", thinkingLevel: "high" },
      baseSession(),
    )).not.toContain("--effort");
  });

  it("supports plan mode via --permission-mode plan", () => {
    const args = provider.buildArgs("Hello", { model: "k3", planMode: true }, baseSession());
    expect(args).toContain("--permission-mode");
    expect(args).toContain("plan");
  });

  // ── buildEnv ───────────────────────────────────────────────────────

  it("points the claude CLI at Moonshot with the stored key", async () => {
    await updateConfig((c) => { c.kimi.apiKey = "sk-kimi-test"; }, tempDir);

    const env = provider.buildEnv({ model: "k3" });
    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.kimi.com/coding/");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-kimi-test");
    expect(env.ENABLE_TOOL_SEARCH).toBe("false");
  });

  it("keeps the inherited claude env vars", () => {
    const env = provider.buildEnv({ model: "k3" });
    expect(env.CLAUDE_CODE_ENABLE_TASKS).toBe("true");
    expect(env.CLAUDE_CODE_DISABLE_CRON).toBe("1");
    expect(env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS).toBe("1");
  });

  it("sets the context-window vars from the selected model", () => {
    const k3 = provider.buildEnv({ model: "k3.1-pro" });
    expect(k3.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe("262144");
    expect(k3.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe("262144");

    const oneM = provider.buildEnv({ model: "k3.1-pro-1m" });
    expect(oneM.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe("1048576");
    expect(oneM.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe("1048576");
  });

  it("falls back to 262144 context tokens for an unknown model", () => {
    const env = provider.buildEnv({});
    expect(env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe("262144");
    expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe("262144");
  });

  it("uses an empty key when none is stored", () => {
    const env = provider.buildEnv({ model: "k3" });
    expect(env.ANTHROPIC_API_KEY).toBe("");
  });

  it("pins the selected model for the parent, aliases, and subagents", () => {
    const aliases = [
      "ANTHROPIC_MODEL",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL",
      "ANTHROPIC_DEFAULT_SONNET_MODEL",
      "ANTHROPIC_DEFAULT_OPUS_MODEL",
      "ANTHROPIC_DEFAULT_FABLE_MODEL",
      "CLAUDE_CODE_SUBAGENT_MODEL",
    ];

    for (const [model, cliValue] of [
      ["k3.1-pro", "k3.1-pro"],
      ["k3.1-pro-1m", "k3.1-pro[1m]"],
      ["k3.1-pro-highspeed", "k3.1-pro-highspeed[1m]"],
      ["kimi-for-coding", "kimi-for-coding"],
      ["kimi-for-coding-highspeed", "kimi-for-coding-highspeed"],
    ] as const) {
      const env = provider.buildEnv({ model });
      for (const alias of aliases) {
        expect(env[alias]).toBe(cliValue);
      }
    }
  });

  it("sets effort in the environment only for supported levels", () => {
    expect(provider.buildEnv({ model: "k3.1-pro", thinkingLevel: "low" }).CLAUDE_CODE_EFFORT_LEVEL).toBe("low");
    expect(provider.buildEnv({ model: "k3.1-pro", thinkingLevel: "medium" }).CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined();
    expect(provider.buildEnv({
      model: "kimi-for-coding-highspeed",
      thinkingLevel: "high",
    }).CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined();
  });

  // ── createStreamAdapter (inherited) ────────────────────────────────

  it("reuses the claude StreamParser", () => {
    expect(provider.createStreamAdapter()).toBeInstanceOf(StreamParser);
  });
});
