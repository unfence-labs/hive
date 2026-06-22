import { describe, it, expect } from "vitest";
import { isSubsequence, fuzzyScore } from "@/lib/fuzzy-match";

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
