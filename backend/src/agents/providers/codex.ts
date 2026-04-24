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
  { id: "gpt-5.5", label: "GPT-5.5", cliValue: "gpt-5.5", isDefault: true, isNew: true, contextWindow: 400_000 },
  { id: "gpt-5.3-codex", label: "GPT-5.3-Codex", cliValue: "gpt-5.3-codex", contextWindow: 400_000 },
];

const CODEX_CAPABILITIES: ProviderCapabilities = {
  thinkingLevels: ["none", "minimal", "low", "medium", "high", "xhigh"],
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
    // Session continuity: `codex exec resume <thread_id> -` on subsequent turns.
    // NOTE: The prompt is provided on stdin via "-" because Codex also reads from
    // piped stdin when a positional prompt is present, which creates noisy stderr.
    const flags = [
      "--json",
      ...(model ? ["--model", model.cliValue] : []),
      "--dangerously-bypass-approvals-and-sandbox",
      "--config", `model_reasoning_effort=${thinkingLevel}`,
    ];

    if (session.isFirstMessage) {
      return ["exec", ...flags, "-"];
    }
    return ["exec", "resume", ...flags, session.sessionId, "-"];
  }

  buildEnv(_options: ProviderMessageOptions): Record<string, string> | undefined {
    // Codex doesn't use env-based thinking control
    return undefined;
  }

  createStreamAdapter(): StreamAdapter {
    return new CodexStreamAdapter();
  }
}
