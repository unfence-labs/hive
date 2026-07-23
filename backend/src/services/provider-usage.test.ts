import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getKimiApiKey: vi.fn(),
  getAllProviderInfo: vi.fn(),
  readFile: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: mocks.spawn,
}));

vi.mock("../agents/providers/registry.js", () => ({
  getAllProviderInfo: mocks.getAllProviderInfo,
}));

vi.mock("../state/config.js", () => ({
  getKimiApiKey: mocks.getKimiApiKey,
}));

vi.mock("node:fs/promises", () => ({
  readFile: mocks.readFile,
}));

import {
  __providerUsageTestHooks,
  getProviderUsageSnapshot,
} from "./provider-usage.js";

function createMockStream(): EventEmitter & { push(data: string): void } {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    push(data: string) {
      emitter.emit("data", Buffer.from(data));
    },
  });
}

function createMockProcess() {
  const proc = new EventEmitter() as ChildProcessWithoutNullStreams & {
    _stdout: ReturnType<typeof createMockStream>;
    _stderr: ReturnType<typeof createMockStream>;
    _stdinWrite: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
  };
  proc._stdout = createMockStream();
  proc._stderr = createMockStream();
  proc.stdout = proc._stdout as unknown as ChildProcessWithoutNullStreams["stdout"];
  proc.stderr = proc._stderr as unknown as ChildProcessWithoutNullStreams["stderr"];
  proc._stdinWrite = vi.fn();
  proc.stdin = {
    write: proc._stdinWrite,
    writable: true,
  } as unknown as ChildProcessWithoutNullStreams["stdin"];
  proc.kill = vi.fn(() => true);
  return proc;
}

function parseWrites(proc: ReturnType<typeof createMockProcess>): Array<Record<string, unknown>> {
  return proc._stdinWrite.mock.calls.flatMap((call) => {
    const raw = String(call[0]).trim();
    if (!raw) return [];
    try {
      return [JSON.parse(raw) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
}

function findMethod(proc: ReturnType<typeof createMockProcess>, method: string): { id: number } {
  const write = parseWrites(proc).find((entry) => entry.method === method);
  if (!write || typeof write.id !== "number") {
    throw new Error(`Expected ${method} request`);
  }
  return { id: write.id };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function appServerResponse(id: number, result: unknown): string {
  return JSON.stringify({ id, result }) + "\n";
}

function mockFetchJson(status: number, body: unknown, headers: Record<string, string> = {}) {
  const response = {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()] ?? null;
      },
    },
    json: async () => body,
  } as Response;
  vi.stubGlobal("fetch", vi.fn(async () => response));
}

// Quota values and timestamps are synthetic. Field names, nesting, and scalar
// types match the live /coding/v1/usages response captured on 2026-07-23.
const SANITIZED_KIMI_LIVE_USAGE_RESPONSE = {
  usage: {
    limit: "100",
    used: "5",
    remaining: "95",
    resetTime: "2026-07-29T12:00:00Z",
  },
  limits: [{
    detail: {
      limit: "100",
      used: "20",
      remaining: "80",
      resetTime: "2026-07-23T17:00:00Z",
    },
    window: {
      duration: 300,
      timeUnit: "TIME_UNIT_MINUTE",
    },
  }],
};

describe("provider usage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.stubGlobal("fetch", vi.fn());
    __providerUsageTestHooks.resetProviderUsageCaches();
    mocks.spawn.mockReset();
    mocks.getKimiApiKey.mockReset();
    mocks.getKimiApiKey.mockReturnValue("");
    mocks.getAllProviderInfo.mockReturnValue([
      {
        id: "claude",
        label: "Claude Code",
        npmPackage: "@anthropic-ai/claude-code",
        installed: true,
        version: "2.1.170",
      },
    ]);
    mocks.readFile.mockResolvedValue(JSON.stringify({
      claudeAiOauth: {
        accessToken: "test-token",
      },
    }));
  });

  it("parses Codex rate-limit payload variants", () => {
    expect(__providerUsageTestHooks.parseCodexRateLimitBuckets({
      primary: {
        usagePercent: 0.42,
        windowDurationMins: 300,
        resetAt: "2026-06-10T17:00:00Z",
      },
    })).toEqual([
      {
        id: "codex",
        label: null,
        usedPercent: 0.4,
        windowDurationMins: 300,
        resetsAt: 1781110800,
        planType: null,
        credits: undefined,
        rateLimitReachedType: null,
      },
    ]);

    expect(__providerUsageTestHooks.parseCodexRateLimitBuckets({
      rateLimitsByLimitId: {
        weekly: {
          limitId: "weekly",
          limitName: "Weekly",
          primary: {
            usedPercent: 87,
            resetsAt: 1781542800,
          },
        },
      },
    })).toMatchObject([
      {
        id: "weekly",
        label: "Weekly",
        usedPercent: 87,
        resetsAt: 1781542800,
      },
    ]);

    expect(__providerUsageTestHooks.parseCodexRateLimitBuckets({
      primary: {
        usedPercent: 1,
        windowDurationMins: 300,
      },
    })).toMatchObject([
      {
        id: "codex",
        usedPercent: 1,
      },
    ]);

    expect(__providerUsageTestHooks.parseCodexRateLimitBuckets({
      primary: {
        usagePercent: 1,
      },
    })).toMatchObject([
      {
        id: "codex",
        usedPercent: 1,
      },
    ]);

    expect(__providerUsageTestHooks.parseCodexRateLimitBuckets({
      primary: {
        usageFraction: 0.42,
      },
    })).toMatchObject([
      {
        id: "codex",
        usedPercent: 42,
      },
    ]);
  });

  it("reads Codex usage through the App Server JSON-RPC endpoint", async () => {
    const proc = createMockProcess();
    mocks.spawn.mockReturnValue(proc);
    mocks.getAllProviderInfo.mockReturnValue([
      {
        id: "codex",
        label: "Codex",
        npmPackage: "@openai/codex",
        installed: true,
        version: "1.0.0",
      },
    ]);

    const resultPromise = getProviderUsageSnapshot();
    const init = findMethod(proc, "initialize");
    proc._stdout.push(appServerResponse(init.id, {}));
    await flushPromises();
    const read = findMethod(proc, "account/rateLimits/read");
    proc._stdout.push(appServerResponse(read.id, {
      rateLimitsByLimitId: {
        primary: {
          limitId: "primary",
          limitName: "Primary",
          primary: {
            usedPercent: 25,
            windowDurationMins: 300,
            resetsAt: 1781110800,
          },
        },
      },
    }));

    const result = await resultPromise;

    expect(mocks.spawn).toHaveBeenCalledWith("codex", ["app-server", "--listen", "stdio://"], expect.any(Object));
    expect(result.providers[0]).toMatchObject({
      id: "codex",
      status: "available",
      buckets: [
        {
          id: "primary",
          label: "Primary",
          usedPercent: 25,
          resetsAt: 1781110800,
        },
      ],
    });
  });

  it("reports a Codex usage error instead of crashing on malformed App Server output", async () => {
    const proc = createMockProcess();
    mocks.spawn.mockReturnValue(proc);
    mocks.getAllProviderInfo.mockReturnValue([
      {
        id: "codex",
        label: "Codex",
        npmPackage: "@openai/codex",
        installed: true,
        version: "1.0.0",
      },
    ]);

    const resultPromise = getProviderUsageSnapshot();
    const init = findMethod(proc, "initialize");
    proc._stdout.push(appServerResponse(init.id, {}));
    await flushPromises();
    expect(findMethod(proc, "account/rateLimits/read")).toBeTruthy();

    proc._stdout.push("{not-json}\n");

    const result = await resultPromise;

    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    expect(result.providers[0]).toMatchObject({
      id: "codex",
      status: "error",
      message: expect.stringContaining("Malformed JSON-RPC line"),
    });
  });

  it("resets the Codex App Server client after an initialize timeout", async () => {
    vi.useFakeTimers();
    const firstProc = createMockProcess();
    const secondProc = createMockProcess();
    mocks.spawn
      .mockReturnValueOnce(firstProc)
      .mockReturnValueOnce(secondProc);
    mocks.getAllProviderInfo.mockReturnValue([
      {
        id: "codex",
        label: "Codex",
        npmPackage: "@openai/codex",
        installed: true,
        version: "1.0.0",
      },
    ]);

    const firstResultPromise = getProviderUsageSnapshot();
    expect(findMethod(firstProc, "initialize")).toBeTruthy();
    await vi.advanceTimersByTimeAsync(5_000);
    const firstResult = await firstResultPromise;

    expect(firstProc.kill).toHaveBeenCalledWith("SIGTERM");
    expect(firstResult.providers[0]).toMatchObject({
      id: "codex",
      status: "error",
      message: "initialize timed out",
    });

    const secondResultPromise = getProviderUsageSnapshot();
    const init = findMethod(secondProc, "initialize");
    procRespond(secondProc, init.id, {});
    await flushPromises();
    const read = findMethod(secondProc, "account/rateLimits/read");
    procRespond(secondProc, read.id, {
      primary: {
        usedPercent: 12,
        resetsAt: 1781110800,
      },
    });

    const secondResult = await secondResultPromise;

    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    expect(secondResult.providers[0]).toMatchObject({
      id: "codex",
      status: "available",
      buckets: [{ id: "codex", usedPercent: 12 }],
    });
  });

  it("closes the Codex usage App Server after the idle window", async () => {
    vi.useFakeTimers();
    const proc = createMockProcess();
    mocks.spawn.mockReturnValue(proc);
    mocks.getAllProviderInfo.mockReturnValue([
      {
        id: "codex",
        label: "Codex",
        npmPackage: "@openai/codex",
        installed: true,
        version: "1.0.0",
      },
    ]);

    const resultPromise = getProviderUsageSnapshot();
    const init = findMethod(proc, "initialize");
    procRespond(proc, init.id, {});
    await flushPromises();
    const read = findMethod(proc, "account/rateLimits/read");
    procRespond(proc, read.id, { primary: { usedPercent: 12 } });

    await resultPromise;
    expect(proc.kill).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(119_999);
    expect(proc.kill).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("keeps the Codex usage App Server warm while cached snapshots continue", async () => {
    vi.useFakeTimers();
    const proc = createMockProcess();
    mocks.spawn.mockReturnValue(proc);
    mocks.getAllProviderInfo.mockReturnValue([
      {
        id: "codex",
        label: "Codex",
        npmPackage: "@openai/codex",
        installed: true,
        version: "1.0.0",
      },
    ]);

    const firstResultPromise = getProviderUsageSnapshot();
    const init = findMethod(proc, "initialize");
    procRespond(proc, init.id, {});
    await flushPromises();
    const firstRead = findMethod(proc, "account/rateLimits/read");
    procRespond(proc, firstRead.id, { primary: { usedPercent: 12 } });
    await firstResultPromise;

    await vi.advanceTimersByTimeAsync(60_000);
    const secondResult = await getProviderUsageSnapshot();
    expect(secondResult.providers[0]).toMatchObject({
      id: "codex",
      buckets: [{ id: "codex", usedPercent: 12 }],
    });
    expect(parseWrites(proc).filter((entry) => entry.method === "account/rateLimits/read")).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(119_999);
    expect(proc.kill).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });

  it("parses Claude OAuth usage windows", () => {
    expect(__providerUsageTestHooks.parseClaudeUsageBuckets({
      five_hour: { utilization: 42, resets_at: "2026-06-10T17:00:00Z" },
      seven_day: { utilization: 61, resets_at: "2026-06-15T17:00:00Z" },
      seven_day_sonnet: { utilization: 1, resets_at: "2026-06-15T17:00:00Z" },
      seven_day_opus: { utilization: 0.42, resets_at: "2026-06-15T17:00:00Z" },
      extra_usage: { utilization: null },
    })).toEqual([
      {
        id: "five_hour",
        label: "5h",
        usedPercent: 42,
        windowDurationMins: 300,
        resetsAt: 1781110800,
      },
      {
        id: "seven_day",
        label: "7d",
        usedPercent: 61,
        windowDurationMins: 10080,
        resetsAt: 1781542800,
      },
      {
        id: "seven_day_sonnet",
        label: "7d Sonnet",
        usedPercent: 1,
        windowDurationMins: 10080,
        resetsAt: 1781542800,
      },
      {
        id: "seven_day_opus",
        label: "7d Opus",
        usedPercent: 0.4,
        windowDurationMins: 10080,
        resetsAt: 1781542800,
      },
    ]);
  });

  it("reads Claude usage from the OAuth usage endpoint", async () => {
    mockFetchJson(200, {
      five_hour: { utilization: 25, resets_at: "2026-06-10T17:00:00Z" },
      seven_day_sonnet: { utilization: 4, resets_at: "2026-06-15T17:00:00Z" },
    });

    const result = await getProviderUsageSnapshot();

    expect(result.providers).toHaveLength(2);
    expect(result.providers[0]).toMatchObject({
      id: "claude",
      status: "available",
      buckets: [
        { id: "five_hour", usedPercent: 25 },
        { id: "seven_day_sonnet", usedPercent: 4 },
      ],
    });
    expect(fetch).toHaveBeenCalledWith("https://api.anthropic.com/api/oauth/usage", expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer test-token",
        "User-Agent": "claude-code/2.1.170",
        "anthropic-beta": "oauth-2025-04-20",
      }),
    }));
  });

  it("reports unknown Claude usage when OAuth credentials are missing", async () => {
    mocks.readFile.mockRejectedValue(new Error("missing"));

    const result = await getProviderUsageSnapshot();

    expect(result.providers[0]).toMatchObject({
      id: "claude",
      status: "unknown",
      buckets: [],
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not return stale Claude buckets when the usage endpoint fails", async () => {
    mockFetchJson(429, {
      error: {
        message: "Rate limited. Please try again later.",
        type: "rate_limit_error",
      },
    }, { "retry-after": "300" });

    const result = await getProviderUsageSnapshot();

    expect(result.providers[0]).toMatchObject({
      id: "claude",
      status: "error",
      buckets: [],
      message: "Rate limited. Please try again later.",
    });
  });

  it("parses the sanitized live Kimi usage contract", () => {
    expect(__providerUsageTestHooks.parseKimiUsageBuckets(
      SANITIZED_KIMI_LIVE_USAGE_RESPONSE,
    )).toEqual([
      {
        id: "weekly",
        label: "7d",
        usedPercent: 5,
        windowDurationMins: 10_080,
        resetsAt: 1785326400,
      },
      {
        id: "five_hour",
        label: "5h",
        usedPercent: 20,
        windowDurationMins: 300,
        resetsAt: 1784826000,
      },
    ]);
  });

  it("accepts snake_case aliases for confirmed Kimi fields", () => {
    expect(__providerUsageTestHooks.parseKimiUsageBuckets({
      usage: {
        used: "25",
        limit: "100",
        reset_time: "2026-06-15T17:00:00Z",
      },
      limits: [{
        detail: {
          used: "65",
          limit: "100",
          reset_time: "2026-06-10T17:00:00Z",
        },
        window: {
          duration: 300,
          time_unit: "TIME_UNIT_MINUTE",
        },
      }],
    })).toEqual([
      {
        id: "weekly",
        label: "7d",
        usedPercent: 25,
        windowDurationMins: 10_080,
        resetsAt: 1781542800,
      },
      {
        id: "five_hour",
        label: "5h",
        usedPercent: 65,
        windowDurationMins: 300,
        resetsAt: 1781110800,
      },
    ]);
  });

  it("reports Kimi usage as unavailable without a configured API key", async () => {
    mocks.getAllProviderInfo.mockReturnValue([]);

    const result = await getProviderUsageSnapshot();

    expect(result.providers).toEqual([
      {
        id: "kimi",
        label: "Kimi",
        status: "unavailable",
        buckets: [],
        lastUpdatedAt: null,
        message: "Kimi API key is not configured.",
      },
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fetches and caches successful Kimi usage until the cache expires", async () => {
    vi.useFakeTimers();
    mocks.getAllProviderInfo.mockReturnValue([]);
    mocks.getKimiApiKey.mockReturnValue("test-kimi-key");
    mockFetchJson(200, SANITIZED_KIMI_LIVE_USAGE_RESPONSE);

    const first = await getProviderUsageSnapshot();
    const cached = await getProviderUsageSnapshot();

    expect(first.providers[0]).toMatchObject({
      id: "kimi",
      status: "available",
      buckets: [
        { id: "weekly", usedPercent: 5 },
        { id: "five_hour", usedPercent: 20 },
      ],
    });
    expect(cached.providers[0]).toEqual(first.providers[0]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("https://api.kimi.com/coding/v1/usages", expect.objectContaining({
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer test-kimi-key",
      },
      signal: expect.any(AbortSignal),
    }));

    mocks.getKimiApiKey.mockReturnValue("replacement-kimi-key");
    await getProviderUsageSnapshot();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(2, "https://api.kimi.com/coding/v1/usages", expect.objectContaining({
      headers: {
        Accept: "application/json",
        Authorization: "Bearer replacement-kimi-key",
      },
    }));

    await vi.advanceTimersByTimeAsync(180_001);
    await getProviderUsageSnapshot();

    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("returns unknown Kimi usage without stale buckets when usable windows disappear", async () => {
    vi.useFakeTimers();
    mocks.getAllProviderInfo.mockReturnValue([]);
    mocks.getKimiApiKey.mockReturnValue("test-kimi-key");
    const responses = [
      SANITIZED_KIMI_LIVE_USAGE_RESPONSE,
      {
        usage: { used: "10", limit: "0" },
        limits: [],
      },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(responses.shift()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    const first = await getProviderUsageSnapshot();
    expect(first.providers[0].buckets).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(180_001);
    const second = await getProviderUsageSnapshot();

    expect(second.providers[0]).toMatchObject({
      id: "kimi",
      status: "unknown",
      buckets: [],
      lastUpdatedAt: null,
      message: "Kimi usage API returned no weekly or 5-hour usage windows.",
    });
  });

  it("returns Kimi HTTP errors without stale cached buckets", async () => {
    vi.useFakeTimers();
    mocks.getAllProviderInfo.mockReturnValue([]);
    mocks.getKimiApiKey.mockReturnValue("test-kimi-key");
    const responses = [
      {
        status: 200,
        body: SANITIZED_KIMI_LIVE_USAGE_RESPONSE,
      },
      {
        status: 401,
        body: {
          error: {
            message: "Invalid API key.",
          },
        },
      },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => {
      const response = responses.shift()!;
      return new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }));

    const first = await getProviderUsageSnapshot();
    expect(first.providers[0].buckets).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(180_001);
    const second = await getProviderUsageSnapshot();

    expect(second.providers[0]).toMatchObject({
      id: "kimi",
      status: "error",
      buckets: [],
      lastUpdatedAt: null,
      message: "Invalid API key.",
    });
  });

  it("backs off Kimi polling after a 429 and honors Retry-After", async () => {
    vi.useFakeTimers();
    mocks.getAllProviderInfo.mockReturnValue([]);
    mocks.getKimiApiKey.mockReturnValue("test-kimi-key");
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return new Response(JSON.stringify({
          error: {
            message: "Rate limited.",
          },
        }), {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "600",
          },
        });
      }
      return new Response(JSON.stringify(SANITIZED_KIMI_LIVE_USAGE_RESPONSE), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const limited = await getProviderUsageSnapshot();
    const backedOff = await getProviderUsageSnapshot();

    expect(limited.providers[0]).toMatchObject({
      id: "kimi",
      status: "error",
      buckets: [],
      message: "Rate limited.",
    });
    expect(backedOff.providers[0]).toMatchObject({
      id: "kimi",
      status: "unknown",
      buckets: [],
      message: "Kimi usage polling is backing off after a rate limit. Try again in 10m.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(180_001);
    await getProviderUsageSnapshot();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    mocks.getKimiApiKey.mockReturnValue("replacement-kimi-key");
    const recovered = await getProviderUsageSnapshot();

    expect(recovered.providers[0]).toMatchObject({
      id: "kimi",
      status: "available",
      buckets: [
        { id: "weekly", usedPercent: 5 },
        { id: "five_hour", usedPercent: 20 },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports an invalid successful Kimi response as an error", async () => {
    mocks.getAllProviderInfo.mockReturnValue([]);
    mocks.getKimiApiKey.mockReturnValue("test-kimi-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{invalid", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    const result = await getProviderUsageSnapshot();

    expect(result.providers[0]).toMatchObject({
      id: "kimi",
      status: "error",
      buckets: [],
      lastUpdatedAt: null,
      message: "Kimi usage API returned an invalid response.",
    });
  });

  it("reports Kimi timeouts and network failures", async () => {
    vi.useFakeTimers();
    mocks.getAllProviderInfo.mockReturnValue([]);
    mocks.getKimiApiKey.mockReturnValue("test-kimi-key");
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    })));

    const timeoutResultPromise = getProviderUsageSnapshot();
    await vi.advanceTimersByTimeAsync(5_000);
    const timeoutResult = await timeoutResultPromise;

    expect(timeoutResult.providers[0]).toMatchObject({
      id: "kimi",
      status: "error",
      buckets: [],
      message: "Kimi usage API timed out.",
    });

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("connection refused");
    }));
    const networkResult = await getProviderUsageSnapshot();

    expect(networkResult.providers[0]).toMatchObject({
      id: "kimi",
      status: "error",
      buckets: [],
      message: "connection refused",
    });
  });
});

function procRespond(proc: ReturnType<typeof createMockProcess>, id: number, result: unknown): void {
  proc._stdout.push(appServerResponse(id, result));
}
