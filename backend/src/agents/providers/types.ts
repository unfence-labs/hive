import type { EventEmitter } from "node:events";
import type { StreamParserEvent } from "../stream-parser.js";
import type { OutputStyle, ThinkingLevel } from "../../types.js";

export type { OutputStyle, ThinkingLevel };

// ── Model & capability definitions ──────────────────────────────────

export interface ModelDefinition {
  /** Display ID sent over the wire, e.g. "opus-4-7" */
  id: string;
  /** Human label, e.g. "Opus 4.7" */
  label: string;
  /** CLI value passed to --model, e.g. "opus" */
  cliValue: string;
  /** Retired model IDs that resolve to this model (e.g. "opus-4-7" -> opus-4-8). */
  aliases?: string[];
  isDefault?: boolean;
  /** Maximum context window size in tokens. */
  contextWindow?: number;
  /** Whether this model supports Claude fast mode (Opus-only). */
  supportsFastMode?: boolean;
  /**
   * Reasoning-effort levels for this model when they differ from the
   * provider-wide capabilities (e.g. GPT-5.6 tiers each support a different
   * ceiling). Absent means the provider's thinkingLevels apply.
   */
  thinkingLevels?: ThinkingLevel[];
  /** Native response styles for this model when they differ from the provider default. */
  outputStyles?: OutputStyle[];
}

/** Resolve a model by ID, honoring retired-ID aliases. */
export function findModel(models: ModelDefinition[], modelId: string | undefined): ModelDefinition | undefined {
  if (!modelId) return undefined;
  return models.find((m) => m.id === modelId || m.aliases?.includes(modelId));
}

export interface ProviderCapabilities {
  /** Reasoning-effort levels this provider supports. Empty array means no control. */
  thinkingLevels: ThinkingLevel[];
  planMode: boolean;
  blockingTools: boolean;
  completions: boolean;
  goals: boolean;
  /** Native response styles supported by every model from this provider. */
  outputStyles?: OutputStyle[];
}

// ── Session state passed to arg builders ────────────────────────────

export interface ProviderSessionState {
  isFirstMessage: boolean;
  sessionId: string;
  systemPrompt?: string;
  skipPermissions: boolean;
  /**
   * Strip interactive/blocking tools (e.g. AskUserQuestion, plan mode) from the
   * turn. Set for unattended agent runs where no human can answer a prompt.
   * Each provider translates this to its own flags; defaults to off so
   * interactive chat is unaffected.
   */
  disableInteractiveTools?: boolean;
  /**
   * Enforce read-only execution: the agent may inspect but not edit files.
   * Each provider translates this to a tool restriction or read-only sandbox;
   * defaults to off so interactive chat is unaffected.
   */
  readOnly?: boolean;
}

// ── Message options subset relevant to providers ────────────────────

export interface ProviderMessageOptions {
  model?: string;
  planMode?: boolean;
  thinkingLevel?: ThinkingLevel;
  fastMode?: boolean;
  outputStyle?: OutputStyle;
}

// ── Stream adapter ──────────────────────────────────────────────────

/**
 * A stream adapter must emit the same events as StreamParser so that
 * conversation-session.ts listeners work identically for all providers.
 */
export type StreamAdapter = EventEmitter<StreamParserEvent> & {
  write(chunk: string): void;
  flush(): void;
};

// ── Provider interface ──────────────────────────────────────────────

export interface AgentProvider {
  readonly id: string;
  readonly command: string;
  readonly models: ModelDefinition[];
  readonly capabilities: ProviderCapabilities;

  /** Build CLI args for a conversation turn. */
  buildArgs?(content: string, options: ProviderMessageOptions, session: ProviderSessionState): string[];

  /** Optional env overrides for the spawned process. */
  buildEnv?(options: ProviderMessageOptions): Record<string, string> | undefined;

  /** Return a stream adapter that normalizes CLI output into StreamParserEvent. */
  createStreamAdapter?(): StreamAdapter;
}

// ── Catalog types (returned by GET /api/models) ─────────────────────

export interface ModelCatalogEntry {
  /** Compound ID: "provider:model", e.g. "claude:opus-4-7" */
  id: string;
  label: string;
  provider: string;
  providerLabel: string;
  isDefault?: boolean;
  capabilities: ProviderCapabilities;
  /** Maximum context window size in tokens. */
  contextWindow?: number;
  /** Whether this model supports Claude fast mode (Opus-only). */
  supportsFastMode?: boolean;
}

export interface ModelCatalogResponse {
  models: ModelCatalogEntry[];
  defaultModelId: string;
}
