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
  { id: "k3", label: "K3", cliValue: "k3", isDefault: true, contextWindow: 262_144 },
  { id: "k3-1m", label: "K3 1M", cliValue: "k3[1m]", contextWindow: 1_048_576 },
  { id: "kimi-for-coding", label: "Kimi for Coding", cliValue: "kimi-for-coding", contextWindow: 262_144 },
];

const KIMI_CAPABILITIES: ProviderCapabilities = {
  // No reasoning-effort control: with an empty list callers never pick a
  // thinking level, so the inherited buildArgs never emits --effort.
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

  override buildArgs(
    content: string,
    options: ProviderMessageOptions,
    session: ProviderSessionState,
  ): string[] {
    // No effort levels: drop any thinkingLevel that leaks in (e.g. from a
    // stale client or stored agent) so --effort is never emitted.
    const { thinkingLevel: _drop, ...rest } = options;
    return super.buildArgs(content, rest, session);
  }

  override buildEnv(options: ProviderMessageOptions): Record<string, string> {
    const contextWindow = findModel(this.models, options.model)?.contextWindow
      ?? DEFAULT_CONTEXT_WINDOW;
    return {
      ...super.buildEnv(options),
      ANTHROPIC_BASE_URL: "https://api.kimi.com/coding/",
      ANTHROPIC_API_KEY: getKimiApiKey(),
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
