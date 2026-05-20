import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(
    (_cmd: string, _args: string[], cb: (...cbArgs: unknown[]) => void) => {
      cb(new Error("not found"), { stdout: "", stderr: "" });
    },
  ),
}));

import { execFile } from "node:child_process";
import {
  resolveProvider,
  getProvider,
  getModelCatalog,
  detectAvailableProviders,
  markProviderAvailable,
  parseVersionFromOutput,
  getAllProviderInfo,
  providerSupportsAppServer,
  providerSupportsAppServerGoals,
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
    const { provider, modelId } = resolveProvider("opus-4-7");
    expect(provider.id).toBe("claude");
    expect(modelId).toBe("opus-4-7");
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

  it("resolves gemini:model-id correctly", () => {
    const { provider, modelId } = resolveProvider("gemini:gemini-3.1-pro-preview");
    expect(provider.id).toBe("gemini");
    expect(modelId).toBe("gemini-3.1-pro-preview");
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

  it("returns gemini provider by ID", () => {
    const provider = getProvider("gemini");
    expect(provider).toBeDefined();
    expect(provider!.id).toBe("gemini");
  });

  it("returns undefined for unknown provider", () => {
    expect(getProvider("unknown")).toBeUndefined();
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

  it("includes codex models when codex is available", () => {
    markProviderAvailable("codex");
    const catalog = getModelCatalog();

    const codexModels = catalog.models.filter((m) => m.provider === "codex");
    expect(codexModels.length).toBeGreaterThan(0);

    for (const model of codexModels) {
      expect(model.id).toMatch(/^codex:/);
    }
  });

  it("includes gemini models when gemini is available", () => {
    markProviderAvailable("gemini");
    const catalog = getModelCatalog();

    const geminiModels = catalog.models.filter((m) => m.provider === "gemini");
    expect(geminiModels.length).toBeGreaterThan(0);

    for (const model of geminiModels) {
      expect(model.id).toMatch(/^gemini:/);
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

  it("uses Gemini CLI label for gemini models", () => {
    markProviderAvailable("gemini");
    const catalog = getModelCatalog();

    const geminiModel = catalog.models.find((m) => m.provider === "gemini");
    expect(geminiModel?.providerLabel).toBe("Gemini CLI");
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

  it("exposes gemini capabilities with thinking disabled", () => {
    markProviderAvailable("gemini");
    const catalog = getModelCatalog();

    const geminiModel = catalog.models.find((m) => m.provider === "gemini");
    expect(geminiModel).toBeDefined();
    expect(geminiModel?.capabilities).toEqual({
      thinkingLevels: [],
      planMode: false,
      blockingTools: false,
      completions: false,
      goals: false,
    });
  });

  it("exposes Codex goals capability when App Server goals are detected", () => {
    markProviderAvailable("codex", { appServer: true, goals: true });
    const catalog = getModelCatalog();

    const codexModels = catalog.models.filter((m) => m.provider === "codex");
    expect(codexModels.length).toBeGreaterThan(0);
    expect(codexModels.every((model) => model.capabilities.goals)).toBe(true);
  });

  it("omits Codex goals capability when App Server goals are not detected", () => {
    markProviderAvailable("codex", { appServer: true, goals: false });
    const catalog = getModelCatalog();

    const codexModels = catalog.models.filter((m) => m.provider === "codex");
    expect(codexModels.length).toBeGreaterThan(0);
    expect(codexModels.every((model) => !model.capabilities.goals)).toBe(true);
  });

  it("does not infer Codex goals support from App Server availability alone", () => {
    markProviderAvailable("codex", { appServer: true });
    const catalog = getModelCatalog();

    expect(providerSupportsAppServerGoals("codex")).toBe(false);
    expect(catalog.models
      .filter((model) => model.provider === "codex")
      .every((model) => !model.capabilities.goals))
      .toBe(true);
  });

  it("includes isNew flag from model definition", () => {
    markProviderAvailable("codex");
    const catalog = getModelCatalog();

    const newModels = catalog.models.filter((m) => m.isNew);
    expect(newModels.length).toBeGreaterThan(0);
    expect(newModels[0].id).toBe("codex:gpt-5.5");
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
    expect(providers.has("gemini")).toBe(true);
    expect(providerSupportsAppServer("codex")).toBe(true);
    expect(providerSupportsAppServerGoals("codex")).toBe(true);
  });

  it("keeps Codex available but disables App Server when the subcommand is missing", async () => {
    mockExecFile.mockImplementation(
      (cmd: string, args: string[], cb: (...a: unknown[]) => void) => {
        if (cmd === "codex" && args[0] === "--version") {
          cb(null, { stdout: "codex 0.2.5\n", stderr: "" });
          return;
        }
        if (cmd === "codex" && args[0] === "app-server") {
          cb(new Error("unknown command"), { stdout: "", stderr: "" });
          return;
        }
        cb(new Error("not found"), { stdout: "", stderr: "" });
      },
    );

    await detectAvailableProviders();

    const catalog = getModelCatalog();
    const providers = new Set(catalog.models.map((m) => m.provider));
    expect(providers.has("codex")).toBe(true);
    expect(providerSupportsAppServer("codex")).toBe(false);
    expect(providerSupportsAppServerGoals("codex")).toBe(false);
  });

  it("marks Codex App Server and goals support when both are available", async () => {
    mockExecFile.mockImplementation(
      (cmd: string, args: string[], cb: (...a: unknown[]) => void) => {
        if (cmd === "codex" && args[0] === "--version") {
          cb(null, { stdout: "codex 0.130.0\n", stderr: "" });
          return;
        }
        if (cmd === "codex" && args[0] === "app-server") {
          cb(null, { stdout: "Usage: codex app-server\n", stderr: "" });
          return;
        }
        cb(new Error("not found"), { stdout: "", stderr: "" });
      },
    );

    await detectAvailableProviders();

    expect(providerSupportsAppServer("codex")).toBe(true);
    expect(providerSupportsAppServerGoals("codex")).toBe(true);
  });

  it("keeps Codex App Server enabled without goals when the flag is unsupported", async () => {
    mockExecFile.mockImplementation(
      (cmd: string, args: string[], cb: (...a: unknown[]) => void) => {
        if (cmd === "codex" && args[0] === "--version") {
          cb(null, { stdout: "codex 0.129.0\n", stderr: "" });
          return;
        }
        if (cmd === "codex" && args[0] === "app-server" && args.includes("--enable")) {
          cb(new Error("unknown option --enable"), { stdout: "", stderr: "unknown option --enable" });
          return;
        }
        if (cmd === "codex" && args[0] === "app-server") {
          cb(null, { stdout: "Usage: codex app-server\n", stderr: "" });
          return;
        }
        cb(new Error("not found"), { stdout: "", stderr: "" });
      },
    );

    await detectAvailableProviders();

    expect(providerSupportsAppServer("codex")).toBe(true);
    expect(providerSupportsAppServerGoals("codex")).toBe(false);
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

  it("can mark Codex as available without App Server support", async () => {
    mockNoProviderCli();
    await detectAvailableProviders();

    markProviderAvailable("codex", { appServer: false });

    expect(getModelCatalog().models.some((m) => m.provider === "codex")).toBe(true);
    expect(providerSupportsAppServer("codex")).toBe(false);
    expect(providerSupportsAppServerGoals("codex")).toBe(false);
  });

  it("can mark Codex App Server available without goals support", async () => {
    mockNoProviderCli();
    await detectAvailableProviders();

    markProviderAvailable("codex", { appServer: true, goals: false });

    expect(providerSupportsAppServer("codex")).toBe(true);
    expect(providerSupportsAppServerGoals("codex")).toBe(false);
  });
});

describe("contextWindow in catalog", () => {
  it("includes contextWindow for Claude models", () => {
    markProviderAvailable("claude");
    const catalog = getModelCatalog();
    const claudeModels = catalog.models.filter((m) => m.provider === "claude");

    const opus = claudeModels.find((m) => m.id === "claude:opus-4-7");
    expect(opus?.contextWindow).toBe(1_000_000);
    const sonnet = claudeModels.find((m) => m.id === "claude:sonnet-4-6");
    expect(sonnet?.contextWindow).toBe(200_000);
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
    expect(info).toHaveLength(3);
    expect(info.every((p) => !p.installed)).toBe(true);
    expect(info.every((p) => p.version === null)).toBe(true);
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
    const gemini = info.find((p) => p.id === "gemini")!;

    expect(claude.label).toBe("Claude Code");
    expect(claude.npmPackage).toBe("@anthropic-ai/claude-code");
    expect(codex.label).toBe("Codex");
    expect(codex.npmPackage).toBe("@openai/codex");
    expect(gemini.label).toBe("Gemini CLI");
    expect(gemini.npmPackage).toBe("@google/gemini-cli");
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
    expect(info.find((p) => p.id === "gemini")?.version).toBeNull();
  });
});
