import { describe, it, expect } from "vitest";
import { formatTokenCount, usageStrokeColor } from "@/lib/format-usage";

describe("formatTokenCount", () => {
  it("returns plain number for < 1000", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(1)).toBe("1");
    expect(formatTokenCount(842)).toBe("842");
    expect(formatTokenCount(999)).toBe("999");
  });

  it("formats thousands with one decimal for 1k–99.9k", () => {
    expect(formatTokenCount(1_000)).toBe("1.0k");
    expect(formatTokenCount(1_500)).toBe("1.5k");
    expect(formatTokenCount(15_200)).toBe("15.2k");
    expect(formatTokenCount(99_999)).toBe("100.0k");
  });

  it("formats hundreds of thousands as rounded k", () => {
    expect(formatTokenCount(100_000)).toBe("100k");
    expect(formatTokenCount(123_456)).toBe("123k");
  });

  it("rolls over to millions when rounding reaches 1000k", () => {
    expect(formatTokenCount(999_999)).toBe("1.0m");
  });

  it("formats millions with one decimal", () => {
    expect(formatTokenCount(1_000_000)).toBe("1.0m");
    expect(formatTokenCount(1_500_000)).toBe("1.5m");
    expect(formatTokenCount(10_000_000)).toBe("10.0m");
  });
});

describe("usageStrokeColor", () => {
  it("returns green for low usage (< 50%)", () => {
    expect(usageStrokeColor(0)).toBe("#34d399");
    expect(usageStrokeColor(0.1)).toBe("#34d399");
    expect(usageStrokeColor(0.49)).toBe("#34d399");
  });

  it("returns yellow for medium usage (50–79%)", () => {
    expect(usageStrokeColor(0.5)).toBe("#facc15");
    expect(usageStrokeColor(0.65)).toBe("#facc15");
    expect(usageStrokeColor(0.79)).toBe("#facc15");
  });

  it("returns red for high usage (>= 80%)", () => {
    expect(usageStrokeColor(0.8)).toBe("#f87171");
    expect(usageStrokeColor(0.95)).toBe("#f87171");
    expect(usageStrokeColor(1.0)).toBe("#f87171");
  });
});
