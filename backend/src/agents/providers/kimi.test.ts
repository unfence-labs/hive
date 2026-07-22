import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { KimiProvider } from "./kimi.js";
import { StreamParser } from "../stream-parser.js";
import { loadConfig, updateConfig } from "../../state/config.js";
import { createTempDir } from "../../utils/test-helpers.js";
import type { ProviderSessionState } from "./types.js";

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

  it("exposes k3 (default), k3-1m, and kimi-for-coding", () => {
    expect(provider.models.map((m) => m.id)).toEqual(["k3", "k3-1m", "kimi-for-coding"]);
    const defaults = provider.models.filter((m) => m.isDefault);
    expect(defaults.map((m) => m.id)).toEqual(["k3"]);
  });

  it("maps models to their cli values and context windows", () => {
    const byId = new Map(provider.models.map((m) => [m.id, m]));
    expect(byId.get("k3")?.cliValue).toBe("k3");
    expect(byId.get("k3")?.contextWindow).toBe(262_144);
    expect(byId.get("k3-1m")?.cliValue).toBe("k3[1m]");
    expect(byId.get("k3-1m")?.contextWindow).toBe(1_048_576);
    expect(byId.get("kimi-for-coding")?.cliValue).toBe("kimi-for-coding");
    expect(byId.get("kimi-for-coding")?.contextWindow).toBe(262_144);
  });

  it("has no fast-mode model", () => {
    expect(provider.models.every((m) => !m.supportsFastMode)).toBe(true);
  });

  // ── Capabilities ───────────────────────────────────────────────────

  it("exposes claude-like capabilities without thinking levels", () => {
    expect(provider.capabilities).toEqual({
      thinkingLevels: [],
      planMode: true,
      blockingTools: true,
      completions: true,
      goals: false,
    });
  });

  // ── buildArgs (inherited from ClaudeProvider) ──────────────────────

  it("builds claude print args with --model k3 and no --effort", () => {
    const args = provider.buildArgs("Hello", { model: "k3" }, baseSession());
    expect(args).toContain("--print");
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
    const idx = args.indexOf("--model");
    expect(args[idx + 1]).toBe("k3");
    expect(args).not.toContain("--effort");
    expect(args.slice(-2)).toEqual(["-p", "Hello"]);
  });

  it("passes k3[1m] as the cli value for k3-1m", () => {
    const args = provider.buildArgs("Hello", { model: "k3-1m" }, baseSession());
    const idx = args.indexOf("--model");
    expect(args[idx + 1]).toBe("k3[1m]");
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
    const k3 = provider.buildEnv({ model: "k3" });
    expect(k3.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe("262144");
    expect(k3.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe("262144");

    const oneM = provider.buildEnv({ model: "k3-1m" });
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

  it("does not set ANTHROPIC_MODEL (model goes via --model)", () => {
    const env = provider.buildEnv({ model: "k3" });
    expect(env.ANTHROPIC_MODEL).toBeUndefined();
  });

  // ── createStreamAdapter (inherited) ────────────────────────────────

  it("reuses the claude StreamParser", () => {
    expect(provider.createStreamAdapter()).toBeInstanceOf(StreamParser);
  });
});
