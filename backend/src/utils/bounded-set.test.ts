import { describe, expect, it } from "vitest";
import { addBounded } from "./bounded-set.js";

describe("addBounded", () => {
  it("adds values without eviction below the cap", () => {
    const set = new Set<string>();
    addBounded(set, "a", 3);
    addBounded(set, "b", 3);
    addBounded(set, "a", 3); // duplicate, no-op
    expect([...set]).toEqual(["a", "b"]);
  });

  it("evicts the oldest entries once the cap is exceeded (FIFO)", () => {
    const set = new Set<string>();
    for (const value of ["a", "b", "c", "d", "e"]) {
      addBounded(set, value, 3);
    }
    expect(set.size).toBe(3);
    expect([...set]).toEqual(["c", "d", "e"]);
    expect(set.has("a")).toBe(false);
  });

  it("re-adding an existing value keeps it without growing", () => {
    const set = new Set<string>(["a", "b", "c"]);
    addBounded(set, "b", 3);
    expect(set.size).toBe(3);
  });
});
