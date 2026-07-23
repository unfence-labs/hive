import { getKimiApiKey } from "../../state/config.js";
import { ClaudeProvider } from "./claude.js";
import {
  findModel,
  type ModelDefinition,
  type ProviderCapabilities,
  type ProviderMessageOptions,
  type ProviderSessionState,
} from "./types.js";

const KIMI_MODELS: ModelDefinition[] = [
  { id: "k3", label: "K3", cliValue: "k3", isDefault: true, contextWindow: 262_144, thinkingLevels: ["low", "high", "max"] },
  { id: "k3-1m", label: "K3 1M", cliValue: "k3[1m]", contextWindow: 1_048_576, thinkingLevels: ["low", "high", "max"] },
  { id: "kimi-for-coding", label: "K2.7 Coding", cliValue: "kimi-for-coding", contextWindow: 262_144 },
  { id: "kimi-for-coding-highspeed", label: "K2.7 Coding Highspeed", cliValue: "kimi-for-coding-highspeed", contextWindow: 262_144 },
];

const KIMI_CAPABILITIES: ProviderCapabilities = {
  // K2.7 has always-on thinking but no selectable effort. K3 opts into effort
  // control through its per-model thinkingLevels above.
  thinkingLevels: [],
  planMode: true,
  blockingTools: true,
  completions: true,
  goals: false,
};

const DEFAULT_CONTEXT_WINDOW = 262_144;

/**
 * Kimi rides the Claude Code CLI pointed at Moonshot's Anthropic-compatible
 * subscription endpoint: same binary, args, and stream format as Claude, with
 * env overrides for the base URL, API key, and per-model context window.
 */
export class KimiProvider extends ClaudeProvider {
  override readonly id: string = "kimi";
  override readonly models: ModelDefinition[] = KIMI_MODELS;
  override readonly capabilities: ProviderCapabilities = KIMI_CAPABILITIES;

  private resolveModelOptions(options: ProviderMessageOptions): {
    model: ModelDefinition | undefined;
    thinkingLevel: ProviderMessageOptions["thinkingLevel"];
  } {
    const model = findModel(this.models, options.model);
    const thinkingLevels = model?.thinkingLevels ?? this.capabilities.thinkingLevels;
    const thinkingLevel = options.thinkingLevel && thinkingLevels.includes(options.thinkingLevel)
      ? options.thinkingLevel
      : undefined;
    return { model, thinkingLevel };
  }

  override buildArgs(
    content: string,
    options: ProviderMessageOptions,
    session: ProviderSessionState,
  ): string[] {
    const { thinkingLevel } = this.resolveModelOptions(options);
    return super.buildArgs(content, { ...options, thinkingLevel }, session);
  }

  override buildEnv(options: ProviderMessageOptions): Record<string, string> {
    const { model, thinkingLevel } = this.resolveModelOptions(options);
    const contextWindow = model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
    const cliModel = model?.cliValue;
    return {
      ...super.buildEnv({ ...options, thinkingLevel }),
      ANTHROPIC_BASE_URL: "https://api.kimi.com/coding/",
      ANTHROPIC_API_KEY: getKimiApiKey(),
      ...(cliModel ? {
        ANTHROPIC_MODEL: cliModel,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: cliModel,
        ANTHROPIC_DEFAULT_SONNET_MODEL: cliModel,
        ANTHROPIC_DEFAULT_OPUS_MODEL: cliModel,
        ANTHROPIC_DEFAULT_FABLE_MODEL: cliModel,
        CLAUDE_CODE_SUBAGENT_MODEL: cliModel,
      } : {}),
      ...(thinkingLevel ? { CLAUDE_CODE_EFFORT_LEVEL: thinkingLevel } : {}),
      // Moonshot's endpoint 400s on tool_reference content blocks, so keep the
      // CLI's tool-search feature off.
      ENABLE_TOOL_SEARCH: "false",
      // Tell the harness the real window so context tracking and auto-compact
      // trigger at Moonshot's limits instead of Claude's defaults.
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: String(contextWindow),
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(contextWindow),
    };
  }
}
