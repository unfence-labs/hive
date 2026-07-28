import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildCodexAppServerArgs } from "../agents/providers/codex-app-server.js";
import {
  JsonRpcStdioClient,
  type JsonRpcRequest,
} from "../agents/providers/json-rpc-stdio.js";
import { getAllProviderInfo } from "../agents/providers/registry.js";
import { getKimiApiKey } from "../state/config.js";
import { buildWorkspaceEnv } from "../utils/env.js";

type UsageStatus = "available" | "unavailable" | "unknown" | "error";
type UsagePercentScale = "percent" | "fraction";

export interface ProviderUsageBucket {
  id: string;
  label: string | null;
  usedPercent: number | null;
  windowDurationMins: number | null;
  resetsAt: number | null;
  planType?: string | null;
  credits?: unknown;
  rateLimitReachedType?: string | null;
}

export interface ProviderUsageEntry {
  id: string;
  label: string;
  status: UsageStatus;
  buckets: ProviderUsageBucket[];
  lastUpdatedAt: string | null;
  message?: string;
}

export interface ProviderUsageResponse {
  providers: ProviderUsageEntry[];
  generatedAt: string;
}

interface CodexRateLimitWindow {
  usedPercent?: unknown;
  usagePercent?: unknown;
  usedFraction?: unknown;
  usageFraction?: unknown;
  windowDurationMins?: unknown;
  resetsAt?: unknown;
  resetAt?: unknown;
}

interface CodexRateLimitBucket {
  limitId?: unknown;
  limitName?: unknown;
  primary?: CodexRateLimitWindow | null;
  secondary?: CodexRateLimitWindow | null;
  planType?: unknown;
  credits?: unknown;
  rateLimitReachedType?: unknown;
}

const CODEX_WINDOW_SLOTS = ["primary", "secondary"] as const;

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken?: unknown;
    expiresAt?: unknown;
  };
  accessToken?: unknown;
  expiresAt?: unknown;
}

interface ClaudeUsageWindow {
  utilization?: unknown;
  resets_at?: unknown;
}

interface ClaudeUsageLimit {
  kind?: unknown;
  percent?: unknown;
  resets_at?: unknown;
  scope?: unknown;
}

interface UsageFetchRequest {
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
  providerLabel: string;
  invalidResponseMessage?: string;
  createHttpError?: (response: Response, body: unknown) => Error;
}

const CODEX_USAGE_CACHE_TTL_MS = 120_000;
const CODEX_REQUEST_TIMEOUT_MS = 5_000;
const CODEX_USAGE_IDLE_TIMEOUT_MS = 120_000;
const CLAUDE_USAGE_CACHE_TTL_MS = 180_000;
const CLAUDE_REQUEST_TIMEOUT_MS = 5_000;
const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_OAUTH_BETA_HEADER = "oauth-2025-04-20";
const KIMI_USAGE_CACHE_TTL_MS = 180_000;
const KIMI_REQUEST_TIMEOUT_MS = 5_000;
const KIMI_USAGE_URL = "https://api.kimi.com/coding/v1/usages";
const CLIENT_INFO = {
  name: "hive",
  title: "Hive",
  version: "0.1.0",
};

let codexClient: CodexUsageClient | null = null;
let codexUsageCache:
  | { value: ProviderUsageEntry; expiresAt: number }
  | null = null;
let claudeUsageCache:
  | { value: ProviderUsageEntry; expiresAt: number }
  | null = null;
let kimiUsageCache:
  | { apiKey: string; value: ProviderUsageEntry; expiresAt: number }
  | null = null;
let claudeBackoffUntil = 0;
let kimiBackoff:
  | { apiKey: string; until: number }
  | null = null;

export async function getProviderUsageSnapshot(): Promise<ProviderUsageResponse> {
  const providerInfo = getAllProviderInfo();
  const generatedAt = new Date().toISOString();
  const providerTasks: Array<Promise<ProviderUsageEntry>> = [];

  const codex = providerInfo.find((provider) => provider.id === "codex");
  if (codex) {
    providerTasks.push(getCodexUsage(codex.label, codex.installed));
  }

  const claude = providerInfo.find((provider) => provider.id === "claude");
  if (claude) {
    providerTasks.push(getClaudeUsage(claude.label, claude.installed, claude.version));
  }

  providerTasks.push(getKimiUsage("Kimi"));

  const providers = await Promise.all(providerTasks);
  return { providers, generatedAt };
}

export function stopProviderUsagePolling(): void {
  codexClient?.close();
  codexClient = null;
}

async function getCodexUsage(label: string, installed: boolean): Promise<ProviderUsageEntry> {
  if (!installed) {
    return unavailableProvider("codex", label, "Codex CLI is not installed.");
  }

  const now = Date.now();
  if (codexUsageCache && codexUsageCache.expiresAt > now) {
    codexClient?.deferIdleClose();
    return codexUsageCache.value;
  }

  try {
    const client = getCodexClient();
    const result = await client.readRateLimits();
    const entry = {
      id: "codex",
      label,
      status: "available" as const,
      buckets: parseCodexRateLimitBuckets(result),
      lastUpdatedAt: new Date().toISOString(),
    };
    codexUsageCache = { value: entry, expiresAt: now + CODEX_USAGE_CACHE_TTL_MS };
    return entry;
  } catch (err) {
    const raw = err instanceof Error ? err.message : "";
    if (isCodexAuthError(raw)) {
      return {
        id: "codex",
        label,
        status: "unknown",
        buckets: [],
        lastUpdatedAt: null,
        message: "Codex sign-in expired. Run `codex login`.",
      };
    }
    return {
      id: "codex",
      label,
      status: "error",
      buckets: [],
      lastUpdatedAt: codexUsageCache?.value.lastUpdatedAt ?? null,
      message: raw ? summarizeCodexError(raw) : "Could not read Codex account usage.",
    };
  }
}

// The app-server surfaces upstream failures as a single line embedding the HTTP status and body.
function isCodexAuthError(message: string): boolean {
  return /\b401\b|\b403\b|token_invalidated|signing in again|not logged in/i.test(message);
}

function summarizeCodexError(message: string): string {
  const firstLine = message.split("\n")[0]!.trim();
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}...` : firstLine;
}

async function getClaudeUsage(label: string, installed: boolean, version: string | null): Promise<ProviderUsageEntry> {
  if (!installed) {
    return unavailableProvider("claude", label, "Claude Code CLI is not installed.");
  }

  const now = Date.now();
  if (claudeUsageCache && claudeUsageCache.expiresAt > now) {
    return claudeUsageCache.value;
  }

  if (claudeBackoffUntil > now) {
    return {
      id: "claude",
      label,
      status: "unknown",
      buckets: [],
      lastUpdatedAt: null,
      message: `Claude usage polling is backing off after a rate limit. Try again ${formatRetryTime(claudeBackoffUntil)}.`,
    };
  }

  try {
    const credentials = await readClaudeCredentials();
    if (!credentials) {
      return {
        id: "claude",
        label,
        status: "unknown",
        buckets: [],
        lastUpdatedAt: null,
        message: "Claude Code OAuth credentials were not found. Run `claude auth login`.",
      };
    }

    // The CLI refreshes the access token on startup; polling an expired one only earns a 401.
    if (credentials.expiresAt !== null && credentials.expiresAt <= now) {
      return {
        id: "claude",
        label,
        status: "unknown",
        buckets: [],
        lastUpdatedAt: null,
        message: "Claude sign-in expired. Run `claude` to refresh the token.",
      };
    }

    const buckets = parseClaudeUsageBuckets(await fetchClaudeUsage(credentials.token, version));
    if (buckets.length === 0) {
      return {
        id: "claude",
        label,
        status: "unknown",
        buckets: [],
        lastUpdatedAt: null,
        message: "Claude usage API returned no usage windows.",
      };
    }

    const entry = {
      id: "claude",
      label,
      status: "available" as const,
      buckets,
      lastUpdatedAt: new Date().toISOString(),
    };
    claudeUsageCache = { value: entry, expiresAt: now + CLAUDE_USAGE_CACHE_TTL_MS };
    claudeBackoffUntil = 0;
    return entry;
  } catch (err) {
    if (err instanceof UsageHttpError && err.status === 429) {
      claudeBackoffUntil = Date.now() + Math.max(err.retryAfterMs ?? 0, CLAUDE_USAGE_CACHE_TTL_MS);
    }
    return {
      id: "claude",
      label,
      status: "error",
      buckets: [],
      lastUpdatedAt: null,
      message: err instanceof Error ? err.message : "Could not read Claude account usage.",
    };
  }
}

async function getKimiUsage(label: string): Promise<ProviderUsageEntry> {
  const apiKey = getKimiApiKey();
  if (!apiKey) {
    kimiUsageCache = null;
    kimiBackoff = null;
    return unavailableProvider("kimi", label, "Kimi API key is not configured.");
  }

  const now = Date.now();
  if (kimiBackoff && kimiBackoff.apiKey !== apiKey) {
    kimiBackoff = null;
  }
  if (
    kimiUsageCache
    && kimiUsageCache.apiKey === apiKey
    && kimiUsageCache.expiresAt > now
  ) {
    return kimiUsageCache.value;
  }

  if (kimiBackoff && kimiBackoff.until > now) {
    return {
      id: "kimi",
      label,
      status: "unknown",
      buckets: [],
      lastUpdatedAt: null,
      message: `Kimi usage polling is backing off after a rate limit. Try again ${formatRetryTime(kimiBackoff.until)}.`,
    };
  }
  kimiBackoff = null;

  try {
    const buckets = parseKimiUsageBuckets(await fetchKimiUsage(apiKey));
    if (buckets.length === 0) {
      kimiUsageCache = null;
      kimiBackoff = null;
      return {
        id: "kimi",
        label,
        status: "unknown",
        buckets: [],
        lastUpdatedAt: null,
        message: "Kimi usage API returned no weekly or 5-hour usage windows.",
      };
    }

    const entry = {
      id: "kimi",
      label,
      status: "available" as const,
      buckets,
      lastUpdatedAt: new Date().toISOString(),
    };
    kimiUsageCache = {
      apiKey,
      value: entry,
      expiresAt: now + KIMI_USAGE_CACHE_TTL_MS,
    };
    kimiBackoff = null;
    return entry;
  } catch (err) {
    kimiUsageCache = null;
    kimiBackoff = err instanceof UsageHttpError && err.status === 429
      ? {
          apiKey,
          until: Date.now() + Math.max(err.retryAfterMs ?? 0, KIMI_USAGE_CACHE_TTL_MS),
        }
      : null;
    return {
      id: "kimi",
      label,
      status: "error",
      buckets: [],
      lastUpdatedAt: null,
      message: err instanceof Error ? err.message : "Could not read Kimi account usage.",
    };
  }
}

function unavailableProvider(id: string, label: string, message: string): ProviderUsageEntry {
  return {
    id,
    label,
    status: "unavailable",
    buckets: [],
    lastUpdatedAt: null,
    message,
  };
}

function getCodexClient(): CodexUsageClient {
  codexClient ??= new CodexUsageClient();
  return codexClient;
}

async function readClaudeCredentials(): Promise<{ token: string; expiresAt: number | null } | null> {
  const credentialsPath = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), ".credentials.json");
  let parsed: ClaudeCredentials;
  try {
    parsed = JSON.parse(await readFile(credentialsPath, "utf-8")) as ClaudeCredentials;
  } catch {
    return null;
  }

  const oauth = asRecord(parsed.claudeAiOauth) ?? parsed;
  const token = asString(oauth.accessToken);
  return token ? { token, expiresAt: asNumber(oauth.expiresAt) } : null;
}

async function fetchClaudeUsage(token: string, version: string | null): Promise<unknown> {
  return fetchUsageJson({
    url: CLAUDE_USAGE_URL,
    timeoutMs: CLAUDE_REQUEST_TIMEOUT_MS,
    providerLabel: "Claude",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "anthropic-beta": CLAUDE_OAUTH_BETA_HEADER,
      "User-Agent": `claude-code/${version ?? "2.0"}`,
    },
    createHttpError: (response, body) => new UsageHttpError(
      response.status,
      errorMessageFromBody(body) ?? `Claude usage API returned HTTP ${response.status}.`,
      retryAfterMs(response.headers.get("retry-after")),
    ),
  });
}

async function fetchKimiUsage(apiKey: string): Promise<unknown> {
  return fetchUsageJson({
    url: KIMI_USAGE_URL,
    timeoutMs: KIMI_REQUEST_TIMEOUT_MS,
    providerLabel: "Kimi",
    invalidResponseMessage: "Kimi usage API returned an invalid response.",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    createHttpError: (response, body) => new UsageHttpError(
      response.status,
      errorMessageFromBody(body) ?? `Kimi usage API returned HTTP ${response.status}.`,
      retryAfterMs(response.headers.get("retry-after")),
    ),
  });
}

async function fetchUsageJson(request: UsageFetchRequest): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetch(request.url, {
      method: "GET",
      headers: request.headers,
      signal: controller.signal,
    });

    let body: unknown = null;
    let parsed = false;
    try {
      body = await response.json();
      parsed = true;
    } catch {
      // Non-JSON failures are converted into the HTTP error below.
    }

    if (!response.ok) {
      throw request.createHttpError?.(response, body) ?? new Error(
        errorMessageFromBody(body)
        ?? `${request.providerLabel} usage API returned HTTP ${response.status}.`,
      );
    }

    if (!parsed && request.invalidResponseMessage) {
      throw new Error(request.invalidResponseMessage);
    }

    return body;
  } catch (err) {
    if (err instanceof UsageHttpError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`${request.providerLabel} usage API timed out.`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// The usage API reports every window in `limits`, including the per-model weekly limits that the
// legacy top-level `seven_day_*` keys now return as null. Those keys remain the fallback for
// accounts whose response predates `limits`.
function parseClaudeUsageBuckets(result: unknown): ProviderUsageBucket[] {
  const record = asRecord(result);
  if (!record) return [];

  const limits = Array.isArray(record.limits) ? record.limits : [];
  const fromLimits = limits
    .map((limit) => parseClaudeUsageLimit(asRecord(limit) as ClaudeUsageLimit | null))
    .filter((bucket): bucket is ProviderUsageBucket => bucket !== null);
  if (fromLimits.length > 0) return fromLimits;

  return Object.entries(CLAUDE_USAGE_BUCKETS)
    .map(([id, config]) => parseClaudeUsageBucket(id, config, asRecord(record[id]) as ClaudeUsageWindow | null))
    .filter((bucket): bucket is ProviderUsageBucket => bucket !== null);
}

const CLAUDE_LIMIT_KINDS: Record<string, { label: string; windowDurationMins: number }> = {
  session: { label: "5h", windowDurationMins: 300 },
  weekly_all: { label: "7d", windowDurationMins: 10_080 },
  weekly_scoped: { label: "7d", windowDurationMins: 10_080 },
};

function parseClaudeUsageLimit(limit: ClaudeUsageLimit | null): ProviderUsageBucket | null {
  const kind = limit ? asString(limit.kind) : null;
  const config = kind ? CLAUDE_LIMIT_KINDS[kind] : null;
  if (!limit || !kind || !config) return null;

  const usedPercent = normalizeClaudePercent(limit.percent);
  if (usedPercent === null) return null;

  // A scoped limit applies to one model, so its name disambiguates it from the account-wide window.
  const model = asString(asRecord(asRecord(limit.scope)?.model)?.display_name);
  return {
    id: model ? `${kind}:${model.toLowerCase()}` : kind,
    label: model ? `${config.label} ${model}` : config.label,
    usedPercent,
    windowDurationMins: config.windowDurationMins,
    resetsAt: parseResetTimestamp(limit.resets_at),
  };
}

const CLAUDE_USAGE_BUCKETS: Record<string, { label: string; windowDurationMins: number | null }> = {
  five_hour: { label: "5h", windowDurationMins: 300 },
  seven_day: { label: "7d", windowDurationMins: 10_080 },
  seven_day_sonnet: { label: "7d Sonnet", windowDurationMins: 10_080 },
  seven_day_opus: { label: "7d Opus", windowDurationMins: 10_080 },
  seven_day_oauth_apps: { label: "7d OAuth apps", windowDurationMins: 10_080 },
  seven_day_cowork: { label: "7d cowork", windowDurationMins: 10_080 },
  seven_day_omelette: { label: "7d omelette", windowDurationMins: 10_080 },
};

function parseClaudeUsageBucket(
  id: string,
  config: { label: string; windowDurationMins: number | null },
  window: ClaudeUsageWindow | null,
): ProviderUsageBucket | null {
  if (!window) return null;
  const usedPercent = normalizeClaudePercent(window.utilization);
  if (usedPercent === null) return null;
  return {
    id,
    label: config.label,
    usedPercent,
    windowDurationMins: config.windowDurationMins,
    resetsAt: parseResetTimestamp(window.resets_at),
  };
}

function parseKimiUsageBuckets(result: unknown): ProviderUsageBucket[] {
  const record = asRecord(result);
  if (!record) return [];

  const buckets: ProviderUsageBucket[] = [];
  const weekly = parseKimiUsageBucket(
    "weekly",
    "7d",
    10_080,
    asRecord(record.usage),
  );
  if (weekly) buckets.push(weekly);

  const limits = Array.isArray(record.limits) ? record.limits : [];
  for (const rawLimit of limits) {
    const limit = asRecord(rawLimit);
    if (!limit) continue;
    const detail = asRecord(limit.detail);
    const window = asRecord(limit.window);
    if (!detail || !isKimiFiveHourWindow(window)) continue;

    const fiveHour = parseKimiUsageBucket(
      "five_hour",
      "5h",
      300,
      detail,
    );
    if (fiveHour) {
      buckets.push(fiveHour);
      break;
    }
  }

  return buckets;
}

function parseKimiUsageBucket(
  id: string,
  label: string,
  windowDurationMins: number,
  usage: Record<string, unknown> | null,
): ProviderUsageBucket | null {
  if (!usage) return null;
  const limit = asNumericString(usage.limit);
  if (limit === null || limit <= 0) return null;

  const used = asNumericString(usage.used);
  if (used === null) return null;

  return {
    id,
    label,
    usedPercent: normalizePercentNumber((used / limit) * 100),
    windowDurationMins,
    resetsAt: parseResetTimestamp(usage.resetTime ?? usage.reset_time),
  };
}

function isKimiFiveHourWindow(window: Record<string, unknown> | null): boolean {
  return asNumber(window?.duration) === 300
    && asString(window?.timeUnit ?? window?.time_unit) === "TIME_UNIT_MINUTE";
}

function parseCodexRateLimitBuckets(result: unknown): ProviderUsageBucket[] {
  const record = asRecord(result);
  const byLimitId = asRecord(record?.rateLimitsByLimitId);
  const source = byLimitId && Object.keys(byLimitId).length > 0
    ? Object.values(byLimitId)
    : [
        record?.rateLimits,
        record?.rateLimit,
        record,
      ];

  return source.flatMap((value) => parseCodexRateLimitBucket(asRecord(value) as CodexRateLimitBucket | null));
}

// Codex reports two windows per metered limit: `primary` and `secondary`. Which one holds the
// short (5h) or long (weekly) window varies by plan, so both are surfaced and labelled by duration.
function parseCodexRateLimitBucket(bucket: CodexRateLimitBucket | null): ProviderUsageBucket[] {
  if (!bucket) return [];
  const limitId = asString(bucket.limitId) ?? asString(bucket.limitName) ?? "codex";
  const limitName = asString(bucket.limitName);

  return CODEX_WINDOW_SLOTS.flatMap((slot) => {
    const window = asRecord(bucket[slot]) as CodexRateLimitWindow | null;
    if (!window) return [];
    const usedPercent = normalizeCodexPercent(window);
    if (usedPercent === null) return [];
    const windowDurationMins = asNumber(window.windowDurationMins);

    return [{
      id: `${limitId}:${slot}`,
      label: codexBucketLabel(limitName, windowDurationMins, slot),
      usedPercent,
      windowDurationMins,
      resetsAt: parseResetTimestamp(window.resetsAt ?? window.resetAt),
      planType: asString(bucket.planType),
      credits: bucket.credits,
      rateLimitReachedType: asString(bucket.rateLimitReachedType),
    }];
  });
}

function codexBucketLabel(
  limitName: string | null,
  windowDurationMins: number | null,
  slot: string,
): string {
  const window = formatWindowLabel(windowDurationMins) ?? slot;
  // The default limit is named after the provider; repeating it would render "Codex Codex 5h".
  return !limitName || limitName.toLowerCase() === "codex"
    ? window
    : `${limitName} ${window}`;
}

function formatWindowLabel(windowDurationMins: number | null): string | null {
  if (windowDurationMins === null || windowDurationMins <= 0) return null;
  if (windowDurationMins < 1440) return `${Math.round(windowDurationMins / 60)}h`;
  return `${Math.round(windowDurationMins / 1440)}d`;
}

function normalizeCodexPercent(window: CodexRateLimitWindow): number | null {
  if (window.usedPercent !== undefined) {
    return normalizeUsagePercent(window.usedPercent, "percent");
  }
  if (window.usagePercent !== undefined) {
    return normalizeUsagePercent(window.usagePercent, "percent");
  }
  return normalizeUsagePercent(window.usedFraction ?? window.usageFraction, "fraction");
}

function normalizeClaudePercent(value: unknown): number | null {
  return normalizeUsagePercent(value, "percent");
}

function normalizeUsagePercent(value: unknown, scale: UsagePercentScale): number | null {
  const num = asNumber(value);
  if (num === null) return null;
  return normalizePercentNumber(scale === "fraction" ? num * 100 : num);
}

function normalizePercentNumber(value: number): number {
  const clamped = Math.max(0, Math.min(100, value));
  if (clamped > 0 && clamped < 10) {
    return Math.round(clamped * 10) / 10;
  }
  return Math.round(clamped);
}

function parseResetTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.round(value / 1000) : Math.round(value);
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? Math.round(millis / 1000) : null;
}

function errorMessageFromBody(body: unknown): string | null {
  const record = asRecord(body);
  const error = asRecord(record?.error);
  return asString(error?.message) ?? asString(record?.message);
}

function retryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const millis = Date.parse(value) - Date.now();
  return Number.isFinite(millis) && millis > 0 ? millis : null;
}

function formatRetryTime(timestampMs: number): string {
  const seconds = Math.max(1, Math.ceil((timestampMs - Date.now()) / 1000));
  if (seconds < 60) return `in ${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  return `in ${minutes}m`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function asNumericString(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

class UsageHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterMs: number | null,
  ) {
    super(message);
  }
}

export const __providerUsageTestHooks = {
  parseCodexRateLimitBuckets,
  parseClaudeUsageBuckets,
  parseKimiUsageBuckets,
  parseResetTimestamp,
  resetProviderUsageCaches() {
    codexUsageCache = null;
    claudeUsageCache = null;
    kimiUsageCache = null;
    claudeBackoffUntil = 0;
    kimiBackoff = null;
    stopProviderUsagePolling();
  },
};

class CodexUsageClient {
  private rpc: JsonRpcStdioClient | null = null;
  private initialized: Promise<void> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  async readRateLimits(): Promise<unknown> {
    this.clearIdleTimer();
    try {
      await this.ensureInitialized();
      return await (this.rpc?.request("account/rateLimits/read")
        ?? Promise.reject(new Error("Codex app-server is not running")));
    } finally {
      this.scheduleIdleClose();
    }
  }

  close(): void {
    this.closeWithError(new Error("Codex usage polling stopped"));
  }

  deferIdleClose(): void {
    this.scheduleIdleClose();
  }

  private closeWithError(err: Error): void {
    this.clearIdleTimer();
    this.rpc?.close(err);
    this.rpc = null;
    this.initialized = null;
  }

  private scheduleIdleClose(): void {
    if (!this.rpc) return;
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.closeWithError(new Error("Codex usage polling idle timeout"));
    }, CODEX_USAGE_IDLE_TIMEOUT_MS);
  }

  private clearIdleTimer(): void {
    if (!this.idleTimer) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return this.initialized;

    this.initialized = (async () => {
      const rpc = new JsonRpcStdioClient({
        command: "codex",
        args: buildCodexAppServerArgs(false),
        env: buildWorkspaceEnv(),
        requestTimeoutMs: CODEX_REQUEST_TIMEOUT_MS,
        closeOnRequestTimeout: true,
      });
      this.rpc = rpc;
      rpc.on("stderr", () => {
        // Account usage is best-effort. Stderr is intentionally not surfaced unless a request fails.
      });
      rpc.on("error", (err) => {
        if (this.rpc === rpc) {
          this.closeWithError(err);
        }
      });
      rpc.on("close", () => {
        if (this.rpc === rpc) {
          this.rpc = null;
          this.initialized = null;
        }
      });
      rpc.on("request", (request) => this.rejectUnsupportedRequest(request));
      rpc.on("notification", (notification) => {
        if (notification.method === "account/rateLimits/updated") {
          this.cacheRateLimits(notification.params);
        }
      });
      rpc.start();

      try {
        await rpc.request("initialize", {
          clientInfo: CLIENT_INFO,
          capabilities: { experimentalApi: true },
        });
        rpc.notify("initialized");
      } catch (err) {
        if (this.rpc === rpc) {
          this.close();
        }
        throw err;
      }
    })();

    return this.initialized;
  }

  private rejectUnsupportedRequest(request: JsonRpcRequest): void {
    this.rpc?.respondError(request.id, `${request.method} is not supported by Hive usage polling`);
  }

  // `account/rateLimits/updated` is a sparse rolling update covering a single limit, so it is
  // merged into the cached snapshot instead of replacing every bucket read earlier.
  private cacheRateLimits(params: unknown): void {
    const updated = parseCodexRateLimitBuckets(params);
    if (updated.length === 0) return;

    const cached = codexUsageCache?.value;
    const merged = new Map(cached?.buckets.map((bucket) => [bucket.id, bucket]));
    for (const bucket of updated) {
      merged.set(bucket.id, bucket);
    }

    codexUsageCache = {
      value: {
        id: "codex",
        label: cached?.label ?? "Codex",
        status: "available",
        buckets: [...merged.values()],
        lastUpdatedAt: new Date().toISOString(),
      },
      expiresAt: Date.now() + CODEX_USAGE_CACHE_TTL_MS,
    };
  }
}
