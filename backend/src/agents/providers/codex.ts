import { CodexStreamAdapter } from "./codex-stream-adapter.js";
import type {
  AgentProvider,
  ModelDefinition,
  ProviderCapabilities,
  ProviderMessageOptions,
  ProviderSessionState,
  StreamAdapter,
  ThinkingLevel,
} from "./types.js";

const CODEX_MODELS: ModelDefinition[] = [
  { id: "gpt-5.3-codex", label: "GPT-5.3-Codex", cliValue: "gpt-5.3-codex", isDefault: true },
];

const CODEX_CAPABILITIES: ProviderCapabilities = {
  thinking: "levels",
  planMode: false,
  blockingTools: false,
  completions: false,
};

const DEFAULT_THINKING_LEVEL: ThinkingLevel = "high";

export class CodexProvider implements AgentProvider {
  readonly id = "codex";
  readonly command = "codex";
  readonly models = CODEX_MODELS;
  readonly capabilities = CODEX_CAPABILITIES;

  buildArgs(
    content: string,
    options: ProviderMessageOptions,
    session: ProviderSessionState,
  ): string[] {
    const model = this.models.find((m) => m.id === options.model);
    const thinkingLevel = options.thinkingLevel ?? DEFAULT_THINKING_LEVEL;

    // Codex uses `codex exec` for non-interactive mode with `--json` for JSONL streaming.
    // Session continuity: `codex exec resume <thread_id> "msg"` on subsequent turns.
    // NOTE: The prompt is a positional arg (not -p, which is --profile in codex CLI).
    const flags = [
      "--json",
      ...(model ? ["--model", model.cliValue] : []),
      "--full-auto",
      "--config", `model_reasoning_effort=${thinkingLevel}`,
    ];

    if (session.isFirstMessage) {
      return ["exec", ...flags, content];
    }
    return ["exec", "resume", ...flags, session.sessionId, content];
  }

  buildEnv(_options: ProviderMessageOptions): Record<string, string> | undefined {
    // Codex doesn't use env-based thinking control
    return undefined;
  }

  createStreamAdapter(): StreamAdapter {
    return new CodexStreamAdapter();
  }
}
