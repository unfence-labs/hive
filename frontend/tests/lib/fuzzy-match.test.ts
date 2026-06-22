import { describe, it, expect } from "vitest";
import { isSubsequence, fuzzyScore, fuzzyScoreFields } from "@/lib/fuzzy-match";

describe("isSubsequence", () => {
  it("returns true when query chars appear in order", () => {
    expect(isSubsequence("code-review", "cr")).toBe(true);
  });

  it("returns false when query chars are out of order", () => {
    expect(isSubsequence("abc", "cb")).toBe(false);
  });
});

describe("fuzzyScore", () => {
  it("scores an exact match highest", () => {
    expect(fuzzyScore("help", "help")).toBe(100);
  });

  it("scores a prefix match", () => {
    expect(fuzzyScore("help", "he")).toBe(80);
  });

  it("scores a substring match", () => {
    expect(fuzzyScore("code-review", "review")).toBe(60);
  });

  it("scores a subsequence match", () => {
    expect(fuzzyScore("code-review", "cr")).toBe(20);
  });

  it("returns 0 when there is no match", () => {
    expect(fuzzyScore("help", "xyz")).toBe(0);
  });

  it("returns 0 for an empty query", () => {
    expect(fuzzyScore("help", "")).toBe(0);
  });
});

describe("fuzzyScoreFields", () => {
  it("uses the strongest field and lets a name match outrank a description-only match", () => {
    const nameMatch = fuzzyScoreFields(["code-review", "Run a review"], "review");
    const descriptionOnly = fuzzyScoreFields(["foo", "bar review"], "review");

    // Name field is a substring match (60); the description-only score is
    // weighted lower because it comes from a later field.
    expect(nameMatch).toBe(60);
    expect(descriptionOnly).toBeGreaterThan(0);
    expect(descriptionOnly).toBeLessThan(nameMatch);
  });
});
