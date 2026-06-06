import { StreamParser } from "../stream-parser.js";
import type {
  AgentProvider,
  ModelDefinition,
  ProviderCapabilities,
  ProviderMessageOptions,
  ProviderSessionState,
  StreamAdapter,
} from "./types.js";

const CLAUDE_MODELS: ModelDefinition[] = [
  { id: "opus-4-8", label: "Opus 4.8", cliValue: "claude-opus-4-8[1m]", isDefault: true, contextWindow: 1_000_000, supportsFastMode: true },
  { id: "sonnet-4-6", label: "Sonnet 4.6", cliValue: "claude-sonnet-4-6", contextWindow: 200_000 },
  { id: "haiku-4-5", label: "Haiku 4.5", cliValue: "claude-haiku-4-5", contextWindow: 200_000 },
];

const MODEL_ALIASES = new Map<string, string>([
  ["opus-4-7", "opus-4-8"],
]);

const CLAUDE_CAPABILITIES: ProviderCapabilities = {
  thinkingLevels: ["low", "medium", "high", "xhigh", "max"],
  planMode: true,
  blockingTools: true,
  completions: true,
};

export class ClaudeProvider implements AgentProvider {
  readonly id = "claude";
  readonly command = "claude";
  readonly models = CLAUDE_MODELS;
  readonly capabilities = CLAUDE_CAPABILITIES;

  buildArgs(
    content: string,
    options: ProviderMessageOptions,
    session: ProviderSessionState,
  ): string[] {
    const requestedModel = options.model ? MODEL_ALIASES.get(options.model) ?? options.model : undefined;
    const model = this.models.find((m) => m.id === requestedModel);
    // Fast mode is Opus-only; never emit it for models that don't support it,
    // even if the flag leaks through from a stale client selection. There is no
    // `--fast` flag in headless mode, so we override the `fastMode` setting for
    // this session via inline `--settings` JSON (merges over settings.json).
    const fastMode = !!options.fastMode && !!model?.supportsFastMode;
    return [
      "--print",
      "--output-format", "stream-json",
      "--verbose",
      ...(model ? ["--model", model.cliValue] : []),
      ...(options.thinkingLevel ? ["--effort", options.thinkingLevel] : []),
      ...(fastMode ? ["--settings", JSON.stringify({ fastMode: true })] : []),
      ...(options.planMode
        ? ["--permission-mode", "plan"]
        : session.skipPermissions ? ["--dangerously-skip-permissions"] : []),
      ...(session.isFirstMessage && session.systemPrompt
        ? ["--append-system-prompt", session.systemPrompt]
        : []),
      ...(session.isFirstMessage
        ? ["--session-id", session.sessionId]
        : ["--resume", session.sessionId]),
      "-p", content,
    ];
  }

  buildEnv(_options: ProviderMessageOptions): Record<string, string> {
    return {
      CLAUDE_CODE_ENABLE_TASKS: "true",
    };
  }

  createStreamAdapter(): StreamAdapter {
    return new StreamParser();
  }
}
