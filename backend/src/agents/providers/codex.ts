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

// Mirrors the current Codex CLI 0.167 lineup, collapsing previous-generation
// models into their current replacement while retaining aliases for stored
// sessions and Team agents. GPT-6.1 Terra requires CLI >= 0.165.
const CODEX_MODELS: ModelDefinition[] = [
  {
    id: "gpt-6-astra",
    label: "GPT-6 Astra",
    cliValue: "gpt-6-astra",
    contextWindow: 272_000,
    thinkingLevels: ["low", "medium", "high", "xhigh", "max", "ultra"],
  },
  {
    id: "gpt-6.1-sol",
    label: "GPT-6.1 Sol",
    cliValue: "gpt-6.1-sol",
    aliases: ["gpt-6-sol", "gpt-5.6-sol", "gpt-5.5", "gpt-5.4", "gpt-5.3-codex"],
    isDefault: true,
    contextWindow: 500_000,
    thinkingLevels: ["low", "medium", "high", "xhigh", "max", "ultra"],
    outputStyles: ["default", "friendly", "pragmatic", "none"],
  },
  {
    id: "gpt-6.1-terra",
    label: "GPT-6.1 Terra",
    cliValue: "gpt-6.1-terra",
    aliases: ["gpt-5.6-terra"],
    contextWindow: 500_000,
    thinkingLevels: ["low", "medium", "high", "xhigh", "max", "ultra"],
  },
  {
    id: "gpt-6-luna",
    label: "GPT-6 Luna",
    cliValue: "gpt-6-luna",
    aliases: ["gpt-5.6-luna", "gpt-5.4-mini", "gpt-5.3-codex-spark"],
    contextWindow: 272_000,
    thinkingLevels: ["low", "medium", "high", "xhigh", "max"],
  },
];

const CODEX_CAPABILITIES: ProviderCapabilities = {
  // Baseline retained for forward-compatible models without per-model levels.
  thinkingLevels: ["low", "medium", "high", "xhigh"],
  planMode: false,
  blockingTools: false,
  completions: true,
  goals: true,
};

export class CodexProvider implements AgentProvider {
  readonly id = "codex";
  readonly command = "codex";
  readonly minimumCliVersion = "0.165.0";
  readonly models = CODEX_MODELS;
  readonly capabilities = CODEX_CAPABILITIES;
}
