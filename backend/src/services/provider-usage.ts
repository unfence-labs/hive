import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildCodexAppServerArgs } from "../agents/providers/codex-app-server.js";
import {
  JsonRpcStdioClient,
  type JsonRpcRequest,
} from "../agents/providers/json-rpc-stdio.js";
import {
  getAllProviderInfo,
  providerSupportsAppServer,
} from "../agents/providers/registry.js";
import { buildWorkspaceEnv } from "../utils/env.js";

type UsageStatus = "available" | "unavailable" | "unknown" | "error";

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

const CODEX_USAGE_CACHE_TTL_MS = 30_000;
const CODEX_REQUEST_TIMEOUT_MS = 5_000;
const CLAUDE_USAGE_CACHE_TTL_MS = 180_000;
const CLAUDE_REQUEST_TIMEOUT_MS = 5_000;
const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_OAUTH_BETA_HEADER = "oauth-2025-04-20";
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
let claudeBackoffUntil = 0;

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

  if (!providerSupportsAppServer("codex")) {
    return unavailableProvider("codex", label, "Installed Codex CLI does not support app-server account usage.");
  }

  const now = Date.now();
  if (codexUsageCache && codexUsageCache.expiresAt > now) {
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
    return {
      id: "codex",
      label,
      status: "error",
      buckets: [],
      lastUpdatedAt: codexUsageCache?.value.lastUpdatedAt ?? null,
      message: err instanceof Error ? err.message : "Could not read Codex account usage.",
    };
  }
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
    const token = await readClaudeAccessToken();
    if (!token) {
      return {
        id: "claude",
        label,
        status: "unknown",
        buckets: [],
        lastUpdatedAt: null,
        message: "Claude Code OAuth credentials were not found. Run `claude auth login`.",
      };
    }

    const response = await fetchClaudeUsage(token, version);
    const buckets = parseClaudeUsageBuckets(response.body);
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
    if (err instanceof ClaudeUsageHttpError && err.status === 429) {
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

async function readClaudeAccessToken(): Promise<string | null> {
  const credentialsPath = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), ".credentials.json");
  let parsed: ClaudeCredentials;
  try {
    parsed = JSON.parse(await readFile(credentialsPath, "utf-8")) as ClaudeCredentials;
  } catch {
    return null;
  }

  const oauth = asRecord(parsed.claudeAiOauth) ?? parsed;
  return asString(oauth.accessToken);
}

async function fetchClaudeUsage(token: string, version: string | null): Promise<{ body: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLAUDE_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(CLAUDE_USAGE_URL, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "anthropic-beta": CLAUDE_OAUTH_BETA_HEADER,
        "User-Agent": `claude-code/${version ?? "2.0"}`,
      },
      signal: controller.signal,
    });

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // Non-JSON failures are converted into the generic HTTP error below.
    }

    if (!response.ok) {
      throw new ClaudeUsageHttpError(
        response.status,
        errorMessageFromBody(body) ?? `Claude usage API returned HTTP ${response.status}.`,
        retryAfterMs(response.headers.get("retry-after")),
      );
    }

    return { body };
  } catch (err) {
    if (err instanceof ClaudeUsageHttpError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Claude usage API timed out.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function parseClaudeUsageBuckets(result: unknown): ProviderUsageBucket[] {
  const record = asRecord(result);
  if (!record) return [];

  return Object.entries(CLAUDE_USAGE_BUCKETS)
    .map(([id, config]) => parseClaudeUsageBucket(id, config, asRecord(record[id]) as ClaudeUsageWindow | null))
    .filter((bucket): bucket is ProviderUsageBucket => bucket !== null);
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

  return source
    .map((value) => parseCodexRateLimitBucket(asRecord(value) as CodexRateLimitBucket | null))
    .filter((bucket): bucket is ProviderUsageBucket => bucket !== null);
}

function parseCodexRateLimitBucket(bucket: CodexRateLimitBucket | null): ProviderUsageBucket | null {
  if (!bucket) return null;
  const primary = asRecord(bucket.primary) as CodexRateLimitWindow | null;
  const id = asString(bucket.limitId) ?? asString(bucket.limitName) ?? (primary ? "codex" : null);
  if (!id || !primary) return null;

  return {
    id,
    label: asString(bucket.limitName),
    usedPercent: normalizePercent(primary.usedPercent ?? primary.usagePercent),
    windowDurationMins: asNumber(primary.windowDurationMins),
    resetsAt: parseResetTimestamp(primary.resetsAt ?? primary.resetAt),
    planType: asString(bucket.planType),
    credits: bucket.credits,
    rateLimitReachedType: asString(bucket.rateLimitReachedType),
  };
}

function normalizePercent(value: unknown): number | null {
  const num = asNumber(value);
  if (num === null) return null;
  const percent = num <= 1 ? num * 100 : num;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function normalizeClaudePercent(value: unknown): number | null {
  const num = asNumber(value);
  if (num === null) return null;
  return Math.max(0, Math.min(100, Math.round(num)));
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

class ClaudeUsageHttpError extends Error {
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
  parseResetTimestamp,
  resetProviderUsageCaches() {
    codexUsageCache = null;
    claudeUsageCache = null;
    claudeBackoffUntil = 0;
    stopProviderUsagePolling();
  },
};

class CodexUsageClient {
  private rpc: JsonRpcStdioClient | null = null;
  private initialized: Promise<void> | null = null;

  async readRateLimits(): Promise<unknown> {
    await this.ensureInitialized();
    return this.rpc?.request("account/rateLimits/read")
      ?? Promise.reject(new Error("Codex app-server is not running"));
  }

  close(): void {
    this.closeWithError(new Error("Codex usage polling stopped"));
  }

  private closeWithError(err: Error): void {
    this.rpc?.close(err);
    this.rpc = null;
    this.initialized = null;
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

  private cacheRateLimits(params: unknown): void {
    const entry = {
      id: "codex",
      label: "Codex",
      status: "available" as const,
      buckets: parseCodexRateLimitBuckets(params),
      lastUpdatedAt: new Date().toISOString(),
    };
    if (entry.buckets.length > 0) {
      codexUsageCache = { value: entry, expiresAt: Date.now() + CODEX_USAGE_CACHE_TTL_MS };
    }
  }
}
