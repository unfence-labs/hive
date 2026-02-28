import { describe, expect, it } from "vitest";
import { formatTimeUntil, getNextRun, getNextRuns } from "@/lib/cron";

describe("cron helpers", () => {
  it("returns null for empty or invalid expressions", () => {
    expect(getNextRuns("", 3)).toBeNull();
    expect(getNextRuns("not-a-cron", 3)).toBeNull();
    expect(getNextRun("")).toBeNull();
  });

  it("returns future run dates for valid expressions", () => {
    const runs = getNextRuns("0 * * * *", 3);
    expect(runs).not.toBeNull();
    expect(runs).toHaveLength(3);
    expect(runs?.every((d) => d instanceof Date)).toBe(true);
    expect(runs?.[0].getTime()).toBeGreaterThan(Date.now());
    expect(runs?.[1].getTime()).toBeGreaterThan(runs?.[0].getTime() ?? 0);
  });

  it("returns the first next run with getNextRun", () => {
    const next = getNextRun("*/15 * * * *");
    expect(next).toBeInstanceOf(Date);
    expect(next?.getTime()).toBeGreaterThan(Date.now());
  });

  it("formats human-readable relative time windows", () => {
    expect(formatTimeUntil(30_000)).toBe("in <1m");
    expect(formatTimeUntil(5 * 60_000)).toBe("in 5m");
    expect(formatTimeUntil(2 * 60 * 60_000)).toBe("in 2h");
    expect(formatTimeUntil((2 * 60 + 15) * 60_000)).toBe("in 2h 15m");
    expect(formatTimeUntil(2 * 24 * 60 * 60_000)).toBe("in 2d");
  });
});
