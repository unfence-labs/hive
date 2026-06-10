import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAllProviderInfo: vi.fn(),
  providerSupportsAppServer: vi.fn(),
  readFile: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: mocks.spawn,
}));

vi.mock("../agents/providers/registry.js", () => ({
  getAllProviderInfo: mocks.getAllProviderInfo,
  providerSupportsAppServer: mocks.providerSupportsAppServer,
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

describe("provider usage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.stubGlobal("fetch", vi.fn());
    __providerUsageTestHooks.resetProviderUsageCaches();
    mocks.spawn.mockReset();
    mocks.providerSupportsAppServer.mockReturnValue(false);
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
        usedPercent: 42,
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
  });

  it("reads Codex usage through the App Server JSON-RPC endpoint", async () => {
    const proc = createMockProcess();
    mocks.spawn.mockReturnValue(proc);
    mocks.providerSupportsAppServer.mockReturnValue(true);
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
            usedPercent: 0.25,
            windowDurationMins: 300,
            resetsAt: 1781110800,
          },
        },
      },
    }));

    const result = await resultPromise;

    expect(mocks.spawn).toHaveBeenCalledWith("codex", ["app-server", "--listen", "stdio://"], expect.any(Object));
    expect(result.providers).toMatchObject([
      {
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
      },
    ]);
  });

  it("reports a Codex usage error instead of crashing on malformed App Server output", async () => {
    const proc = createMockProcess();
    mocks.spawn.mockReturnValue(proc);
    mocks.providerSupportsAppServer.mockReturnValue(true);
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
    mocks.providerSupportsAppServer.mockReturnValue(true);
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
    mocks.providerSupportsAppServer.mockReturnValue(true);
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
    mocks.providerSupportsAppServer.mockReturnValue(true);
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
      seven_day_opus: null,
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
    ]);
  });

  it("reads Claude usage from the OAuth usage endpoint", async () => {
    mockFetchJson(200, {
      five_hour: { utilization: 25, resets_at: "2026-06-10T17:00:00Z" },
      seven_day_sonnet: { utilization: 4, resets_at: "2026-06-15T17:00:00Z" },
    });

    const result = await getProviderUsageSnapshot();

    expect(result.providers).toHaveLength(1);
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
});

function procRespond(proc: ReturnType<typeof createMockProcess>, id: number, result: unknown): void {
  proc._stdout.push(appServerResponse(id, result));
}
