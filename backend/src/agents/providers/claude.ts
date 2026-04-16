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
  { id: "opus-4-7", label: "Opus 4.7", cliValue: "opus", isDefault: true, contextWindow: 200_000 },
  { id: "sonnet-4-6", label: "Sonnet 4.6", cliValue: "sonnet", contextWindow: 1_000_000 },
  { id: "haiku-4-5", label: "Haiku 4.5", cliValue: "haiku", contextWindow: 200_000 },
];

const CLAUDE_CAPABILITIES: ProviderCapabilities = {
  thinking: true,
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
    const model = this.models.find((m) => m.id === options.model);
    return [
      "--print",
      "--output-format", "stream-json",
      "--verbose",
      ...(model ? ["--model", model.cliValue] : []),
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

  buildEnv(options: ProviderMessageOptions): Record<string, string> {
    const env: Record<string, string> = {
      CLAUDE_CODE_ENABLE_TASKS: "true",
    };
    if (options.thinkingEnabled !== undefined) {
      env.MAX_THINKING_TOKENS = options.thinkingEnabled ? "31999" : "0";
    }
    return env;
  }

  createStreamAdapter(): StreamAdapter {
    return new StreamParser();
  }
}
