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
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", cliValue: "gemini-2.5-pro", isDefault: true },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", cliValue: "gemini-2.5-flash" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", cliValue: "gemini-2.5-flash-lite" },
  { id: "gemini-3-pro-preview", label: "Gemini 3 Pro", cliValue: "gemini-3-pro-preview", isNew: true },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash", cliValue: "gemini-3-flash-preview", isNew: true },
];

const GEMINI_CAPABILITIES: ProviderCapabilities = {
  thinking: false, // Gemini 2.5 thinks by default; no CLI flag to control it
  planMode: false,
  blockingTools: false,
  completions: false,
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
