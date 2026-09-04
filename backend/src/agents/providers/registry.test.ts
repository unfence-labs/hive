import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(
    (_cmd: string, _args: string[], cb: (...cbArgs: unknown[]) => void) => {
      cb(new Error("not found"), { stdout: "", stderr: "" });
    },
  ),
}));

import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { loadConfig, updateConfig } from "../../state/config.js";
import { createTempDir } from "../../utils/test-helpers.js";
import {
  resolveProvider,
  getProvider,
  getModelCatalog,
  detectAvailableProviders,
  markProviderAvailable,
  parseVersionFromOutput,
  getAllProviderInfo,
  getDefaultThinkingLevelForModel,
  isKnownModelId,
  isThinkingLevelSupportedForModel,
} from "./registry.js";

// Cast away the overloaded execFile signature so mockImplementation accepts simpler callbacks.
const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

function mockNoProviderCli(): void {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], cb: (...cbArgs: unknown[]) => void) => {
      cb(new Error("not found"), { stdout: "", stderr: "" });
    },
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockNoProviderCli();
  await detectAvailableProviders();
});

describe("resolveProvider", () => {
  it("returns claude provider with default model when no ID given", () => {
    const { provider, modelId } = resolveProvider();
    expect(provider.id).toBe("claude");
    expect(modelId).toBeTruthy();
    // Should be the default model
    const defaultModel = provider.models.find((m) => m.isDefault);
    expect(modelId).toBe(defaultModel?.id);
  });

  it("returns claude provider with default model for undefined", () => {
    const { provider, modelId } = resolveProvider(undefined);
    expect(provider.id).toBe("claude");
    expect(modelId).toBeTruthy();
  });

  it("assumes claude provider for unprefixed model ID", () => {
    const { provider, modelId } = resolveProvider("opus-4-8");
    expect(provider.id).toBe("claude");
    expect(modelId).toBe("opus-4-8");
  });

  it("resolves claude:model-id correctly", () => {
    const { provider, modelId } = resolveProvider("claude:sonnet-4-6");
    expect(provider.id).toBe("claude");
    expect(modelId).toBe("sonnet-4-6");
  });

  it("resolves codex:model-id correctly", () => {
    const { provider, modelId } = resolveProvider("codex:gpt-5.3-codex");
    expect(provider.id).toBe("codex");
    expect(modelId).toBe("gpt-5.3-codex");
  });

  it("throws for unknown provider prefix", () => {
    expect(() => resolveProvider("unknown:some-model")).toThrow("Unknown provider: unknown");
  });

  it("handles model IDs with multiple colons", () => {
    // "codex:gpt-5.3:special" -> provider=codex, modelId=gpt-5.3:special
    const { provider, modelId } = resolveProvider("codex:gpt-5.3:special");
    expect(provider.id).toBe("codex");
    expect(modelId).toBe("gpt-5.3:special");
  });
});

describe("getProvider", () => {
  it("returns claude provider by ID", () => {
    const provider = getProvider("claude");
    expect(provider).toBeDefined();
    expect(provider!.id).toBe("claude");
  });

  it("returns codex provider by ID", () => {
    const provider = getProvider("codex");
    expect(provider).toBeDefined();
    expect(provider!.id).toBe("codex");
  });

  it("returns undefined for unknown provider", () => {
    expect(getProvider("unknown")).toBeUndefined();
  });
});

describe("model helpers", () => {
  it("detects known model IDs without requiring provider availability", () => {
    expect(isKnownModelId("claude:sonnet-5")).toBe(true);
    expect(isKnownModelId("codex:gpt-5.5")).toBe(true);
    expect(isKnownModelId("claude:missing")).toBe(false);
  });

  it("recognizes retired model IDs through aliases", () => {
    expect(isKnownModelId("codex:gpt-5.3-codex")).toBe(true);
    expect(isKnownModelId("claude:opus-4-7")).toBe(true);
    expect(isKnownModelId("claude:sonnet-4-6")).toBe(true);
  });

  it("returns high as the default thinking level when supported", () => {
    expect(getDefaultThinkingLevelForModel("claude:sonnet-5")).toBe("high");
    expect(getDefaultThinkingLevelForModel("codex:gpt-5.5")).toBe("high");
  });

  it("validates thinking levels against the resolved model", () => {
    expect(isThinkingLevelSupportedForModel("claude:sonnet-5", "max")).toBe(true);
    expect(isThinkingLevelSupportedForModel("codex:gpt-5.5", "max")).toBe(false);
    expect(isThinkingLevelSupportedForModel("codex:gpt-5.6-sol", "ultra")).toBe(true);
    expect(isThinkingLevelSupportedForModel("codex:gpt-5.6-luna", "ultra")).toBe(false);
    expect(isThinkingLevelSupportedForModel("codex:gpt-5.6-luna", "max")).toBe(true);
    expect(isThinkingLevelSupportedForModel("claude:missing", "high")).toBe(false);
  });
});

describe("getModelCatalog", () => {
  it("returns empty catalog when no providers are available", async () => {
    const catalog = getModelCatalog();
    expect(catalog.models).toHaveLength(0);
    expect(catalog.defaultModelId).toBe("");
  });

  it("includes only available providers", () => {
    markProviderAvailable("claude");
    const catalog = getModelCatalog();

    const providers = new Set(catalog.models.map((m) => m.provider));
    expect(providers.has("claude")).toBe(true);
    // codex was not marked available
    expect(providers.has("codex")).toBe(false);
  });

  it("excludes explicitly disabled providers from models and the default", () => {
    markProviderAvailable("claude");
    markProviderAvailable("codex");

    const catalog = getModelCatalog({ excludedProviderIds: new Set(["codex"]) });

    expect(catalog.models.every((model) => model.provider === "claude")).toBe(true);
    expect(catalog.defaultModelId).toMatch(/^claude:/);
  });

  it("includes all claude models when claude is available", () => {
    markProviderAvailable("claude");
    const catalog = getModelCatalog();

    const claudeModels = catalog.models.filter((m) => m.provider === "claude");
    expect(claudeModels.length).toBeGreaterThan(0);

    // Each model should have a compound ID
    for (const model of claudeModels) {
      expect(model.id).toMatch(/^claude:/);
    }
  });

  it("advertises native output styles for every Claude model", () => {
    markProviderAvailable("claude");
    const claudeModels = getModelCatalog().models.filter((model) => model.provider === "claude");

    expect(claudeModels.length).toBeGreaterThan(0);
    for (const model of claudeModels) {
      expect(model.capabilities.outputStyles).toEqual([
        "default", "proactive", "concise", "explanatory", "learning",
      ]);
    }
  });

  it("includes codex models when codex is available", () => {
    markProviderAvailable("codex");
    const catalog = getModelCatalog();

    const codexModels = catalog.models.filter((m) => m.provider === "codex");
    expect(codexModels.length).toBeGreaterThan(0);

    for (const model of codexModels) {
      expect(model.id).toMatch(/^codex:/);
    }
  });

  it("advertises Codex personalities only for gpt-5.5", () => {
    markProviderAvailable("codex");
    const codexModels = getModelCatalog().models.filter((model) => model.provider === "codex");

    expect(codexModels.find((model) => model.id === "codex:gpt-5.5")?.capabilities.outputStyles)
      .toEqual(["default", "friendly", "pragmatic", "none"]);
    for (const model of codexModels.filter((model) => model.id !== "codex:gpt-5.5")) {
      expect(model.capabilities.outputStyles).toEqual([]);
    }
  });

  it("sets defaultModelId to claude default when only claude is available", () => {
    markProviderAvailable("claude");
    const catalog = getModelCatalog();

    expect(catalog.defaultModelId).toMatch(/^claude:/);
    const defaultModel = catalog.models.find((m) => m.id === catalog.defaultModelId);
    expect(defaultModel?.isDefault).toBe(true);
  });

  it("prefers the codex default when codex and claude are available", () => {
    markProviderAvailable("claude");
    markProviderAvailable("codex");
    const catalog = getModelCatalog();

    expect(catalog.defaultModelId).toMatch(/^codex:/);
    const defaultModel = catalog.models.find((m) => m.id === catalog.defaultModelId);
    expect(defaultModel?.isDefault).toBe(true);
  });

  it("falls back to first available priority provider when no codex default exists", () => {
    markProviderAvailable("codex");
    const catalog = getModelCatalog();

    expect(catalog.defaultModelId).toBeTruthy();
    expect(catalog.defaultModelId).toMatch(/^codex:/);
  });

  it("includes provider labels", () => {
    markProviderAvailable("claude");
    const catalog = getModelCatalog();

    const claudeModel = catalog.models.find((m) => m.provider === "claude");
    expect(claudeModel?.providerLabel).toBe("Claude Code");
  });

  it("includes capabilities for each model", () => {
    markProviderAvailable("claude");
    const catalog = getModelCatalog();

    for (const model of catalog.models) {
      expect(model.capabilities).toBeDefined();
      expect(Array.isArray(model.capabilities.thinkingLevels)).toBe(true);
      expect(typeof model.capabilities.planMode).toBe("boolean");
      expect(typeof model.capabilities.blockingTools).toBe("boolean");
      expect(typeof model.capabilities.completions).toBe("boolean");
      expect(typeof model.capabilities.goals).toBe("boolean");
    }
  });

  it("reports Codex goals capability", () => {
    markProviderAvailable("codex");
    const catalog = getModelCatalog();

    const codexModels = catalog.models.filter((m) => m.provider === "codex");
    expect(codexModels.length).toBeGreaterThan(0);
    expect(codexModels.every((model) => model.capabilities.goals)).toBe(true);
  });

  it("lists the codex models in catalog order", () => {
    markProviderAvailable("codex");
    const catalog = getModelCatalog();

    const codexIds = catalog.models.filter((m) => m.provider === "codex").map((m) => m.id);
    expect(codexIds).toEqual([
      "codex:gpt-6-astra", "codex:gpt-5.6-sol", "codex:gpt-5.6-terra",
      "codex:gpt-5.6-luna", "codex:gpt-5.3-codex-spark", "codex:gpt-5.5",
    ]);
  });

  it("exposes per-model thinking levels in catalog capabilities", () => {
    markProviderAvailable("codex");
    const catalog = getModelCatalog();

    const byId = new Map(catalog.models.map((m) => [m.id, m]));
    expect(byId.get("codex:gpt-6-astra")?.capabilities.thinkingLevels).toContain("ultra");
    expect(byId.get("codex:gpt-5.6-sol")?.capabilities.thinkingLevels).toContain("ultra");
    expect(byId.get("codex:gpt-5.6-luna")?.capabilities.thinkingLevels).not.toContain("ultra");
    expect(byId.get("codex:gpt-5.5")?.capabilities.thinkingLevels).toEqual([
      "low", "medium", "high", "xhigh",
    ]);
    expect(byId.get("codex:gpt-5.3-codex-spark")?.capabilities.thinkingLevels).toEqual([
      "low", "medium", "high", "xhigh",
    ]);
  });
});

describe("detectAvailableProviders", () => {
  it("clears previously available providers", async () => {
    markProviderAvailable("claude");
    expect(getModelCatalog().models.length).toBeGreaterThan(0);

    mockNoProviderCli();
    await detectAvailableProviders();
    expect(getModelCatalog().models).toHaveLength(0);
  });

  it("marks providers as available when their CLI is found", async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], cb: (...a: unknown[]) => void) => {
        cb(null, { stdout: "v1.0.0", stderr: "" });
      },
    );

    await detectAvailableProviders();
    const catalog = getModelCatalog();
    const providers = new Set(catalog.models.map((m) => m.provider));
    expect(providers.has("claude")).toBe(true);
    expect(providers.has("codex")).toBe(true);
    // Kimi's CLI (claude) was detected too, but the catalog gates it on a
    // stored API key.
    expect(providers.has("kimi")).toBe(false);
  });

  it("ignores providers whose CLI is not found", async () => {
    // Only claude succeeds
    mockExecFile.mockImplementation(
      (cmd: string, _args: string[], cb: (...a: unknown[]) => void) => {
        if (cmd === "claude") {
          cb(null, { stdout: "v1.0.0", stderr: "" });
        } else {
          cb(new Error("not found"), { stdout: "", stderr: "" });
        }
      },
    );

    await detectAvailableProviders();
    const catalog = getModelCatalog();
    const providers = new Set(catalog.models.map((m) => m.provider));
    expect(providers.has("claude")).toBe(true);
    expect(providers.has("codex")).toBe(false);
  });
});

describe("markProviderAvailable", () => {
  it("makes provider appear in catalog", async () => {
    mockNoProviderCli();
    await detectAvailableProviders();
    expect(getModelCatalog().models).toHaveLength(0);

    markProviderAvailable("claude");
    const catalog = getModelCatalog();
    expect(catalog.models.length).toBeGreaterThan(0);
    expect(catalog.models.every((m) => m.provider === "claude")).toBe(true);
  });

  it("makes Codex appear in catalog", async () => {
    mockNoProviderCli();
    await detectAvailableProviders();

    markProviderAvailable("codex");

    expect(getModelCatalog().models.some((m) => m.provider === "codex")).toBe(true);
  });
});

describe("kimi in catalog", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir("hive-registry-kimi-");
    // Warm the module-level key cache from an empty config (key = "").
    await loadConfig(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    // Leave the cache empty for the other describe blocks.
    await loadConfig(tempDir);
  });

  it("is absent when the CLI is available but no API key is stored", () => {
    markProviderAvailable("kimi");
    const catalog = getModelCatalog();
    expect(catalog.models.some((m) => m.provider === "kimi")).toBe(false);
  });

  it("is absent when a key is stored but the CLI is unavailable", async () => {
    await updateConfig((c) => { c.kimi.apiKey = "sk-kimi"; }, tempDir);
    const catalog = getModelCatalog();
    expect(catalog.models.some((m) => m.provider === "kimi")).toBe(false);
  });

  it("appears once the CLI is available and a key is stored, without a re-detect", async () => {
    markProviderAvailable("kimi");
    await updateConfig((c) => { c.kimi.apiKey = "sk-kimi"; }, tempDir);

    const catalog = getModelCatalog();
    const kimiIds = catalog.models.filter((m) => m.provider === "kimi").map((m) => m.id);
    expect(kimiIds).toEqual([
      "kimi:k3",
      "kimi:k3-1m",
      "kimi:kimi-for-coding",
      "kimi:kimi-for-coding-highspeed",
    ]);

    // Clearing the key hides it again on the next catalog build.
    await updateConfig((c) => { c.kimi.apiKey = ""; }, tempDir);
    expect(getModelCatalog().models.some((m) => m.provider === "kimi")).toBe(false);
  });

  it("exposes labels, context windows, and model-specific effort capabilities", async () => {
    markProviderAvailable("kimi");
    await updateConfig((c) => { c.kimi.apiKey = "sk-kimi"; }, tempDir);

    const byId = new Map(getModelCatalog().models.map((m) => [m.id, m]));
    const k3 = byId.get("kimi:k3")!;
    expect(k3.label).toBe("K3");
    expect(k3.providerLabel).toBe("Kimi");
    expect(k3.isDefault).toBe(true);
    expect(k3.contextWindow).toBe(262_144);
    expect(k3.capabilities.thinkingLevels).toEqual(["low", "high", "max"]);
    expect(k3.capabilities.planMode).toBe(true);
    expect(k3.supportsFastMode).toBeUndefined();
    expect(k3.capabilities.outputStyles).toEqual([
      "default", "proactive", "concise", "explanatory", "learning",
    ]);
    expect(byId.get("kimi:k3-1m")?.contextWindow).toBe(1_048_576);
    expect(byId.get("kimi:k3-1m")?.capabilities.thinkingLevels).toEqual(["low", "high", "max"]);
    expect(byId.get("kimi:kimi-for-coding")).toMatchObject({
      label: "K2.7 Coding",
      contextWindow: 262_144,
      capabilities: { thinkingLevels: [] },
    });
    expect(byId.get("kimi:kimi-for-coding-highspeed")).toMatchObject({
      label: "K2.7 Coding Highspeed",
      contextWindow: 262_144,
      capabilities: { thinkingLevels: [] },
    });
  });

  it("never becomes the catalog default", async () => {
    markProviderAvailable("kimi");
    markProviderAvailable("claude");
    await updateConfig((c) => { c.kimi.apiKey = "sk-kimi"; }, tempDir);

    const catalog = getModelCatalog();
    expect(catalog.defaultModelId).toMatch(/^claude:/);
  });

  it("resolves kimi:model ids without a stored key", () => {
    const { provider, modelId } = resolveProvider("kimi:k3");
    expect(provider.id).toBe("kimi");
    expect(modelId).toBe("k3");
    expect(getProvider("kimi")?.id).toBe("kimi");
    expect(isKnownModelId("kimi:k3-1m")).toBe(true);
  });

  it("defaults K3 to high while keeping K2.7 free of effort control", () => {
    expect(getDefaultThinkingLevelForModel("kimi:k3")).toBe("high");
    expect(isThinkingLevelSupportedForModel("kimi:k3", "low")).toBe(true);
    expect(isThinkingLevelSupportedForModel("kimi:k3", "medium")).toBe(false);
    expect(getDefaultThinkingLevelForModel("kimi:kimi-for-coding")).toBeUndefined();
    expect(isThinkingLevelSupportedForModel("kimi:kimi-for-coding", "high")).toBe(false);
  });
});

describe("contextWindow in catalog", () => {
  it("includes contextWindow for Claude models", () => {
    markProviderAvailable("claude");
    const catalog = getModelCatalog();
    const claudeModels = catalog.models.filter((m) => m.provider === "claude");

    const fable = claudeModels.find((m) => m.id === "claude:fable-5-1");
    expect(fable?.contextWindow).toBe(1_000_000);
    const opus = claudeModels.find((m) => m.id === "claude:opus-5");
    expect(opus?.contextWindow).toBe(1_000_000);
    const sonnet = claudeModels.find((m) => m.id === "claude:sonnet-5");
    expect(sonnet?.contextWindow).toBe(1_000_000);
    const haiku = claudeModels.find((m) => m.id === "claude:haiku-4-5");
    expect(haiku?.contextWindow).toBe(200_000);
  });

  it("omits contextWindow for Codex models even when the provider knows the raw window size", () => {
    markProviderAvailable("codex");
    const catalog = getModelCatalog();
    const codexModels = catalog.models.filter((m) => m.provider === "codex");

    for (const model of codexModels) {
      expect(model.contextWindow).toBeUndefined();
    }
  });
});

describe("parseVersionFromOutput", () => {
  it("extracts version from 'v1.0.35'", () => {
    expect(parseVersionFromOutput("v1.0.35")).toBe("1.0.35");
  });

  it("extracts version from bare '1.0.35'", () => {
    expect(parseVersionFromOutput("1.0.35")).toBe("1.0.35");
  });

  it("extracts version from 'claude v1.0.35'", () => {
    expect(parseVersionFromOutput("claude v1.0.35")).toBe("1.0.35");
  });

  it("extracts version from 'codex 0.1.2501.1'", () => {
    expect(parseVersionFromOutput("codex 0.1.2501.1")).toBe("0.1.2501.1");
  });

  it("extracts version with pre-release tag", () => {
    expect(parseVersionFromOutput("1.2.3-beta.1")).toBe("1.2.3-beta.1");
  });

  it("returns null for empty string", () => {
    expect(parseVersionFromOutput("")).toBeNull();
  });

  it("returns null for non-version output", () => {
    expect(parseVersionFromOutput("some random text")).toBeNull();
  });

  it("extracts the first semver-like token in multiline output", () => {
    expect(parseVersionFromOutput("build info\nv2.3.4\nextra")).toBe("2.3.4");
  });
});

describe("getAllProviderInfo", () => {
  it("returns all providers even when none are installed", async () => {
    mockNoProviderCli();
    await detectAvailableProviders();

    const info = getAllProviderInfo();
    expect(info).toHaveLength(2);
    expect(info.every((p) => !p.installed)).toBe(true);
    expect(info.every((p) => p.version === null)).toBe(true);
  });

  it("excludes kimi, which rides the claude CLI and has no binary of its own", async () => {
    mockNoProviderCli();
    await detectAvailableProviders();

    expect(getAllProviderInfo().some((p) => p.id === "kimi")).toBe(false);
  });

  it("includes detected version for installed providers", async () => {
    mockExecFile.mockImplementation(
      (cmd: string, _args: string[], cb: (...a: unknown[]) => void) => {
        if (cmd === "claude") {
          cb(null, { stdout: "claude v1.0.35\n", stderr: "" });
        } else {
          cb(new Error("not found"), { stdout: "", stderr: "" });
        }
      },
    );
    await detectAvailableProviders();

    const info = getAllProviderInfo();
    const claude = info.find((p) => p.id === "claude");
    expect(claude?.installed).toBe(true);
    expect(claude?.version).toBe("1.0.35");
  });

  it("includes correct labels and npm packages", async () => {
    mockNoProviderCli();
    await detectAvailableProviders();

    const info = getAllProviderInfo();
    const claude = info.find((p) => p.id === "claude")!;
    const codex = info.find((p) => p.id === "codex")!;

    expect(claude.label).toBe("Claude Code");
    expect(claude.npmPackage).toBe("@anthropic-ai/claude-code");
    expect(codex.label).toBe("Codex");
    expect(codex.npmPackage).toBe("@openai/codex");
  });

  it("sets version null when CLI output is unparseable", async () => {
    mockExecFile.mockImplementation(
      (cmd: string, _args: string[], cb: (...a: unknown[]) => void) => {
        if (cmd === "claude") {
          cb(null, { stdout: "some weird output\n", stderr: "" });
        } else {
          cb(new Error("not found"), { stdout: "", stderr: "" });
        }
      },
    );
    await detectAvailableProviders();

    const info = getAllProviderInfo();
    const claude = info.find((p) => p.id === "claude")!;
    expect(claude.installed).toBe(true);
    expect(claude.version).toBeNull();
  });

  it("clears previously detected versions on subsequent detection runs", async () => {
    mockExecFile.mockImplementation(
      (cmd: string, _args: string[], cb: (...a: unknown[]) => void) => {
        if (cmd === "claude") {
          cb(null, { stdout: "claude v1.2.3\n", stderr: "" });
        } else {
          cb(new Error("not found"), { stdout: "", stderr: "" });
        }
      },
    );
    await detectAvailableProviders();

    const firstRun = getAllProviderInfo().find((p) => p.id === "claude")!;
    expect(firstRun.installed).toBe(true);
    expect(firstRun.version).toBe("1.2.3");

    mockNoProviderCli();
    await detectAvailableProviders();

    const secondRun = getAllProviderInfo().find((p) => p.id === "claude")!;
    expect(secondRun.installed).toBe(false);
    expect(secondRun.version).toBeNull();
  });

  it("captures versions independently for multiple installed providers", async () => {
    mockExecFile.mockImplementation(
      (cmd: string, _args: string[], cb: (...a: unknown[]) => void) => {
        if (cmd === "claude") {
          cb(null, { stdout: "v1.0.0\n", stderr: "" });
          return;
        }
        if (cmd === "codex") {
          cb(null, { stdout: "codex 0.2.5\n", stderr: "" });
          return;
        }
        cb(new Error("not found"), { stdout: "", stderr: "" });
      },
    );
    await detectAvailableProviders();

    const info = getAllProviderInfo();
    expect(info.find((p) => p.id === "claude")?.version).toBe("1.0.0");
    expect(info.find((p) => p.id === "codex")?.version).toBe("0.2.5");
  });
});
