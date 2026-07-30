import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { getKimiApiKey } from "../../state/config.js";
import { ClaudeProvider } from "./claude.js";
import { CodexProvider } from "./codex.js";
import { KimiProvider } from "./kimi.js";
import {
  findModel,
  type AgentProvider,
  type ModelCatalogEntry,
  type ModelCatalogResponse,
  type ModelDefinition,
  type ThinkingLevel,
} from "./types.js";

const execFile = promisify(execFileCb);

/** Display labels per provider id. Also the source for the setup catalog. */
export const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  kimi: "Kimi",
};

/** npm package name for each provider, used to check for updates. */
export const NPM_PACKAGES: Record<string, string> = {
  claude: "@anthropic-ai/claude-code",
  codex: "@openai/codex",
};

const DEFAULT_PROVIDER_PRIORITY = ["codex", "claude"];

/** All known providers. Availability is checked at runtime via CLI detection. */
const ALL_PROVIDERS: AgentProvider[] = [
  new ClaudeProvider(),
  new CodexProvider(),
  new KimiProvider(),
];

const providerMap = new Map<string, AgentProvider>(
  ALL_PROVIDERS.map((p) => [p.id, p]),
);

/** Set of provider IDs whose CLI binary was detected on the system. */
const availableProviderIds = new Set<string>();

/** Detected installed versions. Key = provider ID, value = version string. */
const detectedVersions = new Map<string, string>();

/**
 * Extract a semver-like version from CLI --version output.
 * Handles formats like "1.0.35", "v1.0.35", "claude v1.0.35", "codex 0.1.2501.1".
 */
export function parseVersionFromOutput(stdout: string): string | null {
  const match = stdout.match(/(\d+\.\d+[\w.-]*)/);
  return match?.[1] ?? null;
}

/**
 * Probe which provider CLIs are installed.
 * Called once at startup (from preflight or main).
 */
export async function detectAvailableProviders(): Promise<void> {
  availableProviderIds.clear();
  detectedVersions.clear();
  for (const provider of ALL_PROVIDERS) {
    try {
      const { stdout } = await execFile(provider.command, ["--version"]);
      availableProviderIds.add(provider.id);
      const version = parseVersionFromOutput(stdout);
      if (version) {
        detectedVersions.set(provider.id, version);
      }
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

function resolveKnownModel(compoundModelId: string): { provider: AgentProvider; model: ModelDefinition } | undefined {
  try {
    const { provider, modelId } = resolveProvider(compoundModelId);
    const model = findModel(provider.models, modelId);
    return model ? { provider, model } : undefined;
  } catch {
    return undefined;
  }
}

/** Effort levels for a model: per-model override, else the provider-wide set. */
function modelThinkingLevels(provider: AgentProvider, model: ModelDefinition): ThinkingLevel[] {
  return model.thinkingLevels ?? provider.capabilities.thinkingLevels;
}

/**
 * Whether a compound model id ("provider:model") refers to a model that exists
 * in the static provider definitions. Availability-independent — it does NOT
 * depend on whether the provider CLI is currently detected — so it is safe for
 * write-time validation of stored model ids (e.g. agent definitions), unlike
 * {@link getModelCatalog} which only lists available providers.
 */
export function isKnownModelId(compoundModelId: string): boolean {
  return resolveKnownModel(compoundModelId) !== undefined;
}

export function getDefaultThinkingLevelForModel(compoundModelId: string): ThinkingLevel | undefined {
  const resolved = resolveKnownModel(compoundModelId);
  const levels = resolved ? modelThinkingLevels(resolved.provider, resolved.model) : [];
  if (levels.length === 0) return undefined;
  return levels.includes("high") ? "high" : levels[0];
}

export function isThinkingLevelSupportedForModel(
  compoundModelId: string,
  thinkingLevel: ThinkingLevel,
): boolean {
  const resolved = resolveKnownModel(compoundModelId);
  return resolved ? modelThinkingLevels(resolved.provider, resolved.model).includes(thinkingLevel) : false;
}

export interface ModelCatalogOptions {
  excludedProviderIds?: ReadonlySet<string>;
}

/** Build the model catalog for the frontend, only including available providers. */
export function getModelCatalog(options: ModelCatalogOptions = {}): ModelCatalogResponse {
  const models: ModelCatalogEntry[] = [];

  for (const provider of ALL_PROVIDERS) {
    if (!availableProviderIds.has(provider.id)) continue;
    if (options.excludedProviderIds?.has(provider.id)) continue;
    // Kimi needs a stored API key on top of the (claude) CLI: without one the
    // Moonshot endpoint can't authenticate, so hide it from the picker. Checked
    // at catalog build time so saving a key takes effect without a restart.
    // resolveProvider is intentionally not gated — stored sessions must resolve.
    if (provider.id === "kimi" && !getKimiApiKey()) continue;
    const providerLabel = PROVIDER_LABELS[provider.id] ?? provider.id;

    for (const model of provider.models) {
      const compoundId = `${provider.id}:${model.id}`;
      models.push({
        id: compoundId,
        label: model.label,
        provider: provider.id,
        providerLabel,
        isDefault: model.isDefault,
        capabilities: {
          ...provider.capabilities,
          thinkingLevels: modelThinkingLevels(provider, model),
        },
        // This is keyed off provider.id ("codex"), not model.id. Catalog IDs are compound
        // values like "codex:gpt-5.5". We still hide Codex context windows here because
        // the CLI only exposes turn-level usage via turn.completed today, which can be
        // cumulative across sub-calls and would make the context ring misleading.
        contextWindow: provider.id === "codex" ? undefined : model.contextWindow,
        supportsFastMode: model.supportsFastMode,
      });
    }
  }

  let defaultModelId = "";
  for (const providerId of DEFAULT_PROVIDER_PRIORITY) {
    const preferredDefault = models.find((m) => m.provider === providerId && m.isDefault)
      ?? models.find((m) => m.provider === providerId);
    if (preferredDefault) {
      defaultModelId = preferredDefault.id;
      break;
    }
  }

  if (!defaultModelId && models.length > 0) {
    defaultModelId = models[0].id;
  }

  return { models, defaultModelId };
}

export interface AgentProviderInfo {
  id: string;
  label: string;
  npmPackage: string;
  installed: boolean;
  version: string | null;
}

/** Return info about all known providers (installed or not). */
export function getAllProviderInfo(): AgentProviderInfo[] {
  // Kimi rides the claude CLI and has no binary of its own to list or update.
  return ALL_PROVIDERS.filter((p) => p.id !== "kimi").map((p) => ({
    id: p.id,
    label: PROVIDER_LABELS[p.id] ?? p.id,
    npmPackage: NPM_PACKAGES[p.id] ?? "",
    installed: availableProviderIds.has(p.id),
    version: detectedVersions.get(p.id) ?? null,
  }));
}
