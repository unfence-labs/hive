import type { EventEmitter } from "node:events";
import type { StreamParserEvent } from "../stream-parser.js";
import type { ThinkingLevel } from "../../types.js";

export type { ThinkingLevel };

// ── Model & capability definitions ──────────────────────────────────

export interface ModelDefinition {
  /** Display ID sent over the wire, e.g. "opus-4-7" */
  id: string;
  /** Human label, e.g. "Opus 4.7" */
  label: string;
  /** CLI value passed to --model, e.g. "opus" */
  cliValue: string;
  isDefault?: boolean;
  isNew?: boolean;
  /** Maximum context window size in tokens. */
  contextWindow?: number;
}

export interface ProviderCapabilities {
  /** Reasoning-effort levels this provider supports. Empty array means no control. */
  thinkingLevels: ThinkingLevel[];
  planMode: boolean;
  blockingTools: boolean;
  completions: boolean;
}

// ── Session state passed to arg builders ────────────────────────────

export interface ProviderSessionState {
  isFirstMessage: boolean;
  sessionId: string;
  systemPrompt?: string;
  skipPermissions: boolean;
  /**
   * Optional allow-list bounding the *available* built-in tool set. Providers
   * that support it (Claude via `--tools`) must restrict the available tools to
   * exactly this list. Independent of `skipPermissions`, which only controls
   * auto-approval. Undefined leaves provider defaults unchanged.
   */
  tools?: string[];
}

// ── Message options subset relevant to providers ────────────────────

export interface ProviderMessageOptions {
  model?: string;
  planMode?: boolean;
  thinkingLevel?: ThinkingLevel;
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
  buildArgs(content: string, options: ProviderMessageOptions, session: ProviderSessionState): string[];

  /** Optional env overrides for the spawned process. */
  buildEnv(options: ProviderMessageOptions): Record<string, string> | undefined;

  /** Return a stream adapter that normalizes CLI output into StreamParserEvent. */
  createStreamAdapter(): StreamAdapter;
}

// ── Catalog types (returned by GET /api/models) ─────────────────────

export interface ModelCatalogEntry {
  /** Compound ID: "provider:model", e.g. "claude:opus-4-7" */
  id: string;
  label: string;
  provider: string;
  providerLabel: string;
  isDefault?: boolean;
  isNew?: boolean;
  capabilities: ProviderCapabilities;
  /** Maximum context window size in tokens. */
  contextWindow?: number;
}

export interface ModelCatalogResponse {
  models: ModelCatalogEntry[];
  defaultModelId: string;
}
