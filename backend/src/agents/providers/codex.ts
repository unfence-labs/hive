import type {
  AgentProvider,
  ModelDefinition,
  ProviderCapabilities,
} from "./types.js";

const CODEX_MODELS: ModelDefinition[] = [
  { id: "gpt-5.5", label: "GPT-5.5", cliValue: "gpt-5.5", isDefault: true, isNew: true, contextWindow: 400_000 },
  { id: "gpt-5.3-codex", label: "GPT-5.3-Codex", cliValue: "gpt-5.3-codex", contextWindow: 400_000 },
];

const CODEX_CAPABILITIES: ProviderCapabilities = {
  thinkingLevels: ["none", "minimal", "low", "medium", "high", "xhigh"],
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
