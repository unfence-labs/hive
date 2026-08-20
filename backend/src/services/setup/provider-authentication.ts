import { SETUP_TOOLS } from "./catalog.js";
import {
  defaultDetectDeps,
  probeToolAuthentication,
  type AuthenticationProbeFailureCategory,
  type DetectDeps,
  type ToolAuthenticationState,
} from "./detect.js";

const DEFAULT_TTL_MS = 60_000;

const PROVIDER_TOOLS = SETUP_TOOLS.flatMap((tool) =>
  tool.authenticatedProviderId
    ? [{ toolId: tool.id, providerId: tool.authenticatedProviderId }]
    : [],
);

export const AUTH_GATED_PROVIDER_IDS = PROVIDER_TOOLS.map(
  ({ providerId }) => providerId,
);

interface AuthenticationLogger {
  warn: (
    details: {
      provider: string;
      category: AuthenticationProbeFailureCategory;
      durationMs: number;
    },
    message: string,
  ) => void;
}

export interface ProviderAuthenticationReader {
  getState: (providerId: string) => ToolAuthenticationState;
}

export interface ProviderAuthenticationCacheOptions {
  detect?: DetectDeps;
  logger?: AuthenticationLogger;
  now?: () => number;
  ttlMs?: number;
}

export interface ProviderAuthenticationRefreshOptions {
  /** Run a fresh batch after any currently running batch. */
  force?: boolean;
}

/**
 * Last reliable provider authentication, refreshed in one parallel batch.
 * Reads never wait for a stale refresh: the previous snapshot remains usable.
 */
export class ProviderAuthenticationCache implements ProviderAuthenticationReader {
  private readonly detect: DetectDeps;
  private logger?: AuthenticationLogger;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly states = new Map<string, ToolAuthenticationState>();
  private readonly failingProviders = new Set<string>();
  private refreshedAt: number | null = null;
  private inFlight?: Promise<void>;
  private queuedAfter?: Promise<void>;
  private queuedRefresh?: Promise<void>;

  constructor(options: ProviderAuthenticationCacheOptions = {}) {
    this.detect = options.detect ?? defaultDetectDeps();
    this.logger = options.logger;
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  setLogger(logger: AuthenticationLogger): void {
    this.logger = logger;
  }

  getState(providerId: string): ToolAuthenticationState {
    if (this.refreshedAt === null || this.now() - this.refreshedAt >= this.ttlMs) {
      void this.refresh();
    }
    return this.states.get(providerId) ?? "unknown";
  }

  refresh(options: ProviderAuthenticationRefreshOptions = {}): Promise<void> {
    if (this.inFlight) {
      if (!options.force) return this.inFlight;
      const current = this.inFlight;
      if (this.queuedAfter === current && this.queuedRefresh) return this.queuedRefresh;

      const queued = current
        .catch(() => undefined)
        .then(() => this.startRefresh())
        .finally(() => {
          if (this.queuedRefresh !== queued) return;
          this.queuedAfter = undefined;
          this.queuedRefresh = undefined;
        });
      this.queuedAfter = current;
      this.queuedRefresh = queued;
      return queued;
    }

    return this.startRefresh();
  }

  private startRefresh(): Promise<void> {
    const task = Promise.all(
      PROVIDER_TOOLS.map(async ({ toolId, providerId }) => {
        const startedAt = this.now();
        const result = await probeToolAuthentication(toolId, this.detect);
        const durationMs = Math.max(0, this.now() - startedAt);

        if (result.state === "unknown") {
          if (!this.failingProviders.has(providerId) && result.failureCategory) {
            this.logger?.warn(
              { provider: providerId, category: result.failureCategory, durationMs },
              "provider authentication probe failed",
            );
          }
          this.failingProviders.add(providerId);
          if (!this.states.has(providerId)) this.states.set(providerId, "unknown");
          return;
        }

        this.failingProviders.delete(providerId);
        this.states.set(providerId, result.state);
      }),
    ).then(() => {
      this.refreshedAt = this.now();
    });

    this.inFlight = task.finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }
}

export const providerAuthentication = new ProviderAuthenticationCache();
