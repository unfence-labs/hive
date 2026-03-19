import { StreamParser } from "../stream-parser.js";
import type {
  AgentProvider,
  BuildArgsResult,
  ModelDefinition,
  ProviderCapabilities,
  ProviderMessageOptions,
  ProviderSessionState,
  StreamAdapter,
} from "./types.js";

const CLAUDE_MODELS: ModelDefinition[] = [
  { id: "opus-4-6", label: "Opus 4.6", cliValue: "opus", isDefault: true, contextWindow: 1_000_000 },
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
  ): BuildArgsResult {
    const model = this.models.find((m) => m.id === options.model);

    // System prompt: use --append-system-prompt for small prompts,
    // prepend to stdin for large ones to avoid E2BIG.
    const systemPrompt = session.isFirstMessage ? session.systemPrompt : undefined;
    const systemPromptViaArgs = systemPrompt && Buffer.byteLength(systemPrompt, "utf-8") < 100_000;

    let stdinContent = content;
    if (systemPrompt && !systemPromptViaArgs) {
      stdinContent = `<system-instructions>\n${systemPrompt}\n</system-instructions>\n\n${content}`;
    }

    return {
      args: [
        "--print",
        "--output-format", "stream-json",
        "--verbose",
        ...(model ? ["--model", model.cliValue] : []),
        ...(options.planMode
          ? ["--permission-mode", "plan"]
          : session.skipPermissions ? ["--dangerously-skip-permissions"] : []),
        ...(systemPromptViaArgs ? ["--append-system-prompt", systemPrompt] : []),
        ...(session.isFirstMessage
          ? ["--session-id", session.sessionId]
          : ["--resume", session.sessionId]),
      ],
      stdin: stdinContent,
    };
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
