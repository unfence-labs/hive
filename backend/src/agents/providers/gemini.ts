import { GeminiStreamAdapter } from "./gemini-stream-adapter.js";
import type {
  AgentProvider,
  ModelDefinition,
  ProviderCapabilities,
  ProviderMessageOptions,
  ProviderSessionState,
  StreamAdapter,
} from "./types.js";

const GEMINI_MODELS: ModelDefinition[] = [
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", cliValue: "gemini-3.1-pro-preview", isDefault: true },
  { id: "gemini-3-pro-preview", label: "Gemini 3 Pro", cliValue: "gemini-3-pro-preview" },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash", cliValue: "gemini-3-flash-preview" },
];

const GEMINI_CAPABILITIES: ProviderCapabilities = {
  thinkingLevels: [], // Gemini 2.5+ thinks by default; no CLI flag to control it
  planMode: false,
  blockingTools: false,
  completions: false,
  goals: false,
};

export class GeminiProvider implements AgentProvider {
  readonly id = "gemini";
  readonly command = "gemini";
  readonly models = GEMINI_MODELS;
  readonly capabilities = GEMINI_CAPABILITIES;

  buildArgs(
    content: string,
    options: ProviderMessageOptions,
    session: ProviderSessionState,
  ): string[] {
    const model = this.models.find((m) => m.id === options.model);
    // KNOWN GAP: Gemini exposes no clean CLI mechanism to strip interactive
    // tools (session.disableInteractiveTools) or enforce a read-only sandbox
    // (session.readOnly). Agent-run enforcement for Gemini is therefore
    // prompt-only — the system prompt must instruct read-only behavior. We do
    // not emit fake flags here; do not pretend to enforce what the CLI cannot.
    return [
      "-p", content,
      "-o", "stream-json",
      ...(model ? ["-m", model.cliValue] : []),
      "-y",
      ...(session.isFirstMessage ? [] : ["-r", session.sessionId]),
    ];
  }

  buildEnv(_options: ProviderMessageOptions): Record<string, string> | undefined {
    return undefined;
  }

  createStreamAdapter(): StreamAdapter {
    return new GeminiStreamAdapter();
  }
}
