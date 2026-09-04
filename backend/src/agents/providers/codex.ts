import type {
  AgentProvider,
  ModelDefinition,
  OutputStyle,
  ProviderCapabilities,
} from "./types.js";

export type CodexPersonality = "friendly" | "pragmatic" | "none";

export function codexPersonalityFromOutputStyle(
  outputStyle: OutputStyle | undefined,
): CodexPersonality | undefined {
  switch (outputStyle) {
    case "friendly":
    case "pragmatic":
    case "none":
      return outputStyle;
    default:
      return undefined;
  }
}

// Mirrors the Codex CLI 0.153 model lineup. Astra requires CLI >= 0.153;
// GPT-5.6 tiers require CLI >= 0.144 and cap reasoning effort per model.
const CODEX_MODELS: ModelDefinition[] = [
  {
    id: "gpt-6-astra",
    label: "GPT-6 Astra",
    cliValue: "gpt-6-astra",
    contextWindow: 272_000,
    thinkingLevels: ["low", "medium", "high", "xhigh", "max", "ultra"],
  },
  {
    id: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    cliValue: "gpt-5.6-sol",
    aliases: ["gpt-5.3-codex"],
    isDefault: true,
    contextWindow: 272_000,
    thinkingLevels: ["low", "medium", "high", "xhigh", "max", "ultra"],
  },
  {
    id: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    cliValue: "gpt-5.6-terra",
    aliases: ["gpt-5.4"],
    contextWindow: 272_000,
    thinkingLevels: ["low", "medium", "high", "xhigh", "max", "ultra"],
  },
  {
    id: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    cliValue: "gpt-5.6-luna",
    aliases: ["gpt-5.4-mini"],
    contextWindow: 272_000,
    thinkingLevels: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "gpt-5.3-codex-spark",
    label: "GPT-5.3-Codex-Spark",
    cliValue: "gpt-5.3-codex-spark",
    contextWindow: 128_000,
  },
  {
    id: "gpt-5.5",
    label: "GPT-5.5",
    cliValue: "gpt-5.5",
    contextWindow: 272_000,
    outputStyles: ["default", "friendly", "pragmatic", "none"],
  },
];

const CODEX_CAPABILITIES: ProviderCapabilities = {
  // Baseline for models without per-model levels (Codex Spark and GPT-5.5).
  thinkingLevels: ["low", "medium", "high", "xhigh"],
  planMode: false,
  blockingTools: false,
  completions: true,
  goals: true,
};

export class CodexProvider implements AgentProvider {
  readonly id = "codex";
  readonly command = "codex";
  readonly models = CODEX_MODELS;
  readonly capabilities = CODEX_CAPABILITIES;
}
