import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { ClaudeProvider } from "./claude.js";
import { CodexProvider } from "./codex.js";
import type { AgentProvider, ModelCatalogEntry, ModelCatalogResponse } from "./types.js";

const execFile = promisify(execFileCb);

const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
};

/** All known providers. Availability is checked at runtime via CLI detection. */
const ALL_PROVIDERS: AgentProvider[] = [
  new ClaudeProvider(),
  new CodexProvider(),
];

const providerMap = new Map<string, AgentProvider>(
  ALL_PROVIDERS.map((p) => [p.id, p]),
);

/** Set of provider IDs whose CLI binary was detected on the system. */
const availableProviderIds = new Set<string>();

/**
 * Probe which provider CLIs are installed.
 * Called once at startup (from preflight or main).
 */
export async function detectAvailableProviders(): Promise<void> {
  availableProviderIds.clear();
  for (const provider of ALL_PROVIDERS) {
    try {
      await execFile(provider.command, ["--version"]);
      availableProviderIds.add(provider.id);
    } catch {
      // CLI not found — provider won't appear in catalog
    }
  }
}

/** Mark a provider as available (used by preflight or tests). */
export function markProviderAvailable(providerId: string): void {
  availableProviderIds.add(providerId);
}

/**
 * Resolve a compound model ID ("provider:model") to its provider.
 * Falls back to the default provider (claude) if no prefix.
 */
export function resolveProvider(compoundModelId?: string): { provider: AgentProvider; modelId: string } {
  if (!compoundModelId) {
    const claude = providerMap.get("claude")!;
    const defaultModel = claude.models.find((m) => m.isDefault)!;
    return { provider: claude, modelId: defaultModel.id };
  }

  const colonIdx = compoundModelId.indexOf(":");
  if (colonIdx === -1) {
    // No prefix — assume claude for backward compatibility
    const claude = providerMap.get("claude")!;
    return { provider: claude, modelId: compoundModelId };
  }

  const providerId = compoundModelId.slice(0, colonIdx);
  const modelId = compoundModelId.slice(colonIdx + 1);
  const provider = providerMap.get(providerId);
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  return { provider, modelId };
}

/** Get a provider by ID. */
export function getProvider(providerId: string): AgentProvider | undefined {
  return providerMap.get(providerId);
}

/** Build the model catalog for the frontend, only including available providers. */
export function getModelCatalog(): ModelCatalogResponse {
  const models: ModelCatalogEntry[] = [];
  let defaultModelId = "";

  for (const provider of ALL_PROVIDERS) {
    if (!availableProviderIds.has(provider.id)) continue;
    const providerLabel = PROVIDER_LABELS[provider.id] ?? provider.id;

    for (const model of provider.models) {
      const compoundId = `${provider.id}:${model.id}`;
      models.push({
        id: compoundId,
        label: model.label,
        provider: provider.id,
        providerLabel,
        isDefault: model.isDefault,
        isNew: model.isNew,
        capabilities: provider.capabilities,
      });
      if (provider.id === "claude" && model.isDefault) {
        defaultModelId = compoundId;
      }
    }
  }

  if (!defaultModelId && models.length > 0) {
    defaultModelId = models[0].id;
  }

  return { models, defaultModelId };
}
