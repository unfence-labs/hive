import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { ClaudeProvider } from "./claude.js";
import { CodexProvider } from "./codex.js";
import { GeminiProvider } from "./gemini.js";
import type { AgentProvider, ModelCatalogEntry, ModelCatalogResponse, ProviderCapabilities } from "./types.js";

const execFile = promisify(execFileCb);

const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
};

/** npm package name for each provider, used to check for updates. */
const NPM_PACKAGES: Record<string, string> = {
  claude: "@anthropic-ai/claude-code",
  codex: "@openai/codex",
  gemini: "@google/gemini-cli",
};

const DEFAULT_PROVIDER_PRIORITY = ["codex", "claude", "gemini"];

/** All known providers. Availability is checked at runtime via CLI detection. */
const ALL_PROVIDERS: AgentProvider[] = [
  new ClaudeProvider(),
  new CodexProvider(),
  new GeminiProvider(),
];

const providerMap = new Map<string, AgentProvider>(
  ALL_PROVIDERS.map((p) => [p.id, p]),
);

/** Set of provider IDs whose CLI binary was detected on the system. */
const availableProviderIds = new Set<string>();

/** Detected installed versions. Key = provider ID, value = version string. */
const detectedVersions = new Map<string, string>();

/** Provider IDs whose richer optional protocol surface was detected. */
const appServerProviderIds = new Set<string>();
const appServerGoalsProviderIds = new Set<string>();

let providerDetectionCompleted = false;

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
  appServerProviderIds.clear();
  appServerGoalsProviderIds.clear();
  providerDetectionCompleted = false;
  for (const provider of ALL_PROVIDERS) {
    try {
      const { stdout } = await execFile(provider.command, ["--version"]);
      availableProviderIds.add(provider.id);
      const version = parseVersionFromOutput(stdout);
      if (version) {
        detectedVersions.set(provider.id, version);
      }
      if (provider.id === "codex") {
        const appServerCapabilities = await detectCodexAppServerCapabilities();
        if (appServerCapabilities.appServer) {
          appServerProviderIds.add(provider.id);
        }
        if (appServerCapabilities.goals) {
          appServerGoalsProviderIds.add(provider.id);
        }
      }
    } catch {
      // CLI not found — provider won't appear in catalog
    }
  }
  providerDetectionCompleted = true;
}

/** Mark a provider as available (used by preflight or tests). */
export function markProviderAvailable(providerId: string, options?: { appServer?: boolean; goals?: boolean }): void {
  providerDetectionCompleted = true;
  availableProviderIds.add(providerId);
  if (providerId === "codex") {
    if (options?.appServer === false) {
      appServerProviderIds.delete(providerId);
      appServerGoalsProviderIds.delete(providerId);
    } else {
      appServerProviderIds.add(providerId);
      if (options?.goals === true) {
        appServerGoalsProviderIds.add(providerId);
      } else {
        appServerGoalsProviderIds.delete(providerId);
      }
    }
  }
}

export function providerSupportsAppServer(providerId: string): boolean {
  if (providerId !== "codex") return false;
  if (!providerDetectionCompleted) return true;
  return appServerProviderIds.has(providerId);
}

export function providerSupportsAppServerGoals(providerId: string): boolean {
  if (providerId !== "codex") return false;
  if (!providerDetectionCompleted) return false;
  return appServerGoalsProviderIds.has(providerId);
}

function catalogCapabilitiesForProvider(provider: AgentProvider): ProviderCapabilities {
  if (provider.id !== "codex") return provider.capabilities;
  return {
    ...provider.capabilities,
    goals: providerSupportsAppServerGoals(provider.id),
  };
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
        capabilities: catalogCapabilitiesForProvider(provider),
        // This is keyed off provider.id ("codex"), not model.id. Catalog IDs are compound
        // values like "codex:gpt-5.5". We still hide Codex context windows here because
        // the CLI only exposes turn-level usage via turn.completed today, which can be
        // cumulative across sub-calls and would make the context ring misleading.
        contextWindow: provider.id === "codex" ? undefined : model.contextWindow,
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
  return ALL_PROVIDERS.map((p) => ({
    id: p.id,
    label: PROVIDER_LABELS[p.id] ?? p.id,
    npmPackage: NPM_PACKAGES[p.id] ?? "",
    installed: availableProviderIds.has(p.id),
    version: detectedVersions.get(p.id) ?? null,
  }));
}

async function detectCodexAppServerCapabilities(): Promise<{ appServer: boolean; goals: boolean }> {
  try {
    await execFile("codex", ["app-server", "--help"]);
  } catch {
    return { appServer: false, goals: false };
  }

  try {
    await execFile("codex", ["app-server", "--enable", "goals", "--help"]);
    return { appServer: true, goals: true };
  } catch {
    return { appServer: true, goals: false };
  }
}
