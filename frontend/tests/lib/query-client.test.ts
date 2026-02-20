import { describe, expect, it } from "vitest";
import { queryClient } from "@/lib/query-client";

describe("queryClient defaults", () => {
  it("configures query defaults for WS-driven freshness", () => {
    const queries = queryClient.getDefaultOptions().queries;

    expect(queries?.staleTime).toBe(5 * 60 * 1000);
    expect(queries?.refetchOnWindowFocus).toBe(false);
    expect(queries?.refetchOnReconnect).toBe(false);
    expect(queries?.retry).toBe(2);
  });

  it("uses exponential retry delay with a 10s cap", () => {
    const retryDelay = queryClient.getDefaultOptions().queries
      ?.retryDelay as (attempt: number) => number;

    expect(retryDelay(0)).toBe(1000);
    expect(retryDelay(1)).toBe(2000);
    expect(retryDelay(2)).toBe(4000);
    expect(retryDelay(10)).toBe(10_000);
  });

  it("disables mutation retries to avoid duplicate writes", () => {
    const mutations = queryClient.getDefaultOptions().mutations;
    expect(mutations?.retry).toBe(0);
  });
});
