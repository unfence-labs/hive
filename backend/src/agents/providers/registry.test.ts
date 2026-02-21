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
} from "./registry.js";

// Cast away the overloaded execFile signature so mockImplementation accepts simpler callbacks.
const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
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
    const { provider, modelId } = resolveProvider("opus-4-6");
    expect(provider.id).toBe("claude");
    expect(modelId).toBe("opus-4-6");
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

describe("getModelCatalog", () => {
  it("returns empty catalog when no providers are available", async () => {
    // Clear available providers
    await detectAvailableProviders();
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

  it("sets defaultModelId to claude default when available", () => {
    markProviderAvailable("claude");
    const catalog = getModelCatalog();

    expect(catalog.defaultModelId).toMatch(/^claude:/);
    const defaultModel = catalog.models.find((m) => m.id === catalog.defaultModelId);
    expect(defaultModel?.isDefault).toBe(true);
  });

  it("falls back to first model when no claude default", () => {
    markProviderAvailable("codex");
    const catalog = getModelCatalog();

    // No claude available, so defaultModelId should be the first codex model
    // or the first model overall
    expect(catalog.defaultModelId).toBeTruthy();
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
      expect(typeof model.capabilities.thinking).toBeDefined();
      expect(typeof model.capabilities.planMode).toBe("boolean");
      expect(typeof model.capabilities.blockingTools).toBe("boolean");
    }
  });

  it("includes isNew flag from model definition", () => {
    markProviderAvailable("claude");
    const catalog = getModelCatalog();

    const sonnet = catalog.models.find((m) => m.id === "claude:sonnet-4-6");
    expect(sonnet?.isNew).toBe(true);
  });
});

describe("detectAvailableProviders", () => {
  it("clears previously available providers", async () => {
    markProviderAvailable("claude");
    expect(getModelCatalog().models.length).toBeGreaterThan(0);

    // Mock all CLIs as not found
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], cb: (...a: unknown[]) => void) => {
        cb(new Error("not found"), { stdout: "", stderr: "" });
      },
    );

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
    // Reset: mock all CLIs as not found before detecting
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], cb: (...a: unknown[]) => void) => {
        cb(new Error("not found"), { stdout: "", stderr: "" });
      },
    );
    await detectAvailableProviders();
    expect(getModelCatalog().models).toHaveLength(0);

    markProviderAvailable("claude");
    const catalog = getModelCatalog();
    expect(catalog.models.length).toBeGreaterThan(0);
    expect(catalog.models.every((m) => m.provider === "claude")).toBe(true);
  });
});
