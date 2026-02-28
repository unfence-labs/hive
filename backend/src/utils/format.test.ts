import { describe, it, expect } from "vitest";
import { formatDuration } from "./format.js";

describe("formatDuration", () => {
  it("formats zero", () => {
    expect(formatDuration(0)).toBe("0s");
  });

  it("formats sub-second durations", () => {
    expect(formatDuration(500)).toBe("1s");
    expect(formatDuration(499)).toBe("0s");
  });

  it("formats seconds only", () => {
    expect(formatDuration(45000)).toBe("45s");
    expect(formatDuration(59499)).toBe("59s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(60000)).toBe("1m 0s");
    expect(formatDuration(92000)).toBe("1m 32s");
    expect(formatDuration(125400)).toBe("2m 5s");
  });

  it("rounds to nearest second", () => {
    expect(formatDuration(1499)).toBe("1s");
    expect(formatDuration(1500)).toBe("2s");
  });
});
