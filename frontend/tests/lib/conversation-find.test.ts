import { describe, it, expect } from "vitest";
import {
  findMatchesInText,
  collectMatches,
  stepIndex,
  clampIndex,
} from "@/lib/conversation-find";

describe("findMatchesInText", () => {
  it("finds a single match", () => {
    expect(findMatchesInText("hello world", "world")).toEqual([{ start: 6, end: 11 }]);
  });

  it("finds multiple matches", () => {
    expect(findMatchesInText("ab ab ab", "ab")).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
      { start: 6, end: 8 },
    ]);
  });

  it("returns [] when there is no match", () => {
    expect(findMatchesInText("hello", "xyz")).toEqual([]);
  });

  it("is case-insensitive", () => {
    expect(findMatchesInText("Dev dev DEV", "dev")).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 8, end: 11 },
    ]);
  });

  it("is accent-sensitive: 'resume' does not match 'résumé'", () => {
    expect(findMatchesInText("résumé", "resume")).toEqual([]);
  });

  it("is accent-sensitive: 'résumé' does not match 'resume'", () => {
    expect(findMatchesInText("resume", "résumé")).toEqual([]);
  });

  it("matches accented text case-insensitively without shifting offsets", () => {
    expect(findMatchesInText("RÉSUMÉ", "résumé")).toEqual([{ start: 0, end: 6 }]);
  });

  it("does not overlap matches", () => {
    expect(findMatchesInText("aaaa", "aa")).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it("returns [] for an empty query", () => {
    expect(findMatchesInText("anything", "")).toEqual([]);
  });

  it("treats a space query literally", () => {
    expect(findMatchesInText("a b c", " ")).toEqual([
      { start: 1, end: 2 },
      { start: 3, end: 4 },
    ]);
  });

  it("matches at the very start of the text", () => {
    expect(findMatchesInText("start here", "start")).toEqual([{ start: 0, end: 5 }]);
  });

  it("matches at the very end of the text", () => {
    expect(findMatchesInText("the end", "end")).toEqual([{ start: 4, end: 7 }]);
  });
});

describe("collectMatches", () => {
  it("flattens matches in document order across segments", () => {
    expect(collectMatches(["foo bar", "bar foo"], "foo")).toEqual([
      { segmentIndex: 0, start: 0, end: 3 },
      { segmentIndex: 1, start: 4, end: 7 },
    ]);
  });

  it("carries the correct segmentIndex", () => {
    expect(collectMatches(["xx", "x", "xxx"], "x")).toEqual([
      { segmentIndex: 0, start: 0, end: 1 },
      { segmentIndex: 0, start: 1, end: 2 },
      { segmentIndex: 1, start: 0, end: 1 },
      { segmentIndex: 2, start: 0, end: 1 },
      { segmentIndex: 2, start: 1, end: 2 },
      { segmentIndex: 2, start: 2, end: 3 },
    ]);
  });

  it("skips segments with zero matches but keeps order", () => {
    expect(collectMatches(["hit", "miss", "hit"], "hit")).toEqual([
      { segmentIndex: 0, start: 0, end: 3 },
      { segmentIndex: 2, start: 0, end: 3 },
    ]);
  });

  it("returns [] for an empty query", () => {
    expect(collectMatches(["a", "b"], "")).toEqual([]);
  });

  it("returns [] when no segment matches", () => {
    expect(collectMatches(["a", "b"], "z")).toEqual([]);
  });
});

describe("stepIndex", () => {
  it("steps forward", () => {
    expect(stepIndex(0, 3, 1)).toBe(1);
  });

  it("wraps forward from the last index to 0", () => {
    expect(stepIndex(2, 3, 1)).toBe(0);
  });

  it("steps backward", () => {
    expect(stepIndex(2, 3, -1)).toBe(1);
  });

  it("wraps backward from 0 to the last index", () => {
    expect(stepIndex(0, 3, -1)).toBe(2);
  });

  it("from -1 forward goes to 0", () => {
    expect(stepIndex(-1, 3, 1)).toBe(0);
  });

  it("from -1 backward goes to the last index", () => {
    expect(stepIndex(-1, 3, -1)).toBe(2);
  });

  it("returns -1 when total is 0", () => {
    expect(stepIndex(0, 0, 1)).toBe(-1);
    expect(stepIndex(-1, 0, -1)).toBe(-1);
  });

  it("handles a single-element total", () => {
    expect(stepIndex(0, 1, 1)).toBe(0);
    expect(stepIndex(0, 1, -1)).toBe(0);
  });

  it("treats an out-of-range current defensively", () => {
    expect(stepIndex(99, 3, 1)).toBe(0);
    expect(stepIndex(99, 3, -1)).toBe(2);
  });
});

describe("clampIndex", () => {
  it("leaves an in-range index unchanged", () => {
    expect(clampIndex(1, 3)).toBe(1);
  });

  it("clamps an above-range index to total-1", () => {
    expect(clampIndex(5, 3)).toBe(2);
  });

  it("returns -1 when total is 0", () => {
    expect(clampIndex(0, 0)).toBe(-1);
  });

  it("clamps a negative index to 0", () => {
    expect(clampIndex(-4, 3)).toBe(0);
  });
});
