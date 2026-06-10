import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAllProviderInfo: vi.fn(),
  providerSupportsAppServer: vi.fn(),
  readFile: vi.fn(),
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
    vi.stubGlobal("fetch", vi.fn());
    __providerUsageTestHooks.resetProviderUsageCaches();
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
