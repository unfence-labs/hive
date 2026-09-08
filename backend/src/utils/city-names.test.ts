import { describe, it, expect, vi } from "vitest";
import { pickCityName, CITIES } from "./city-names.js";

describe("pickCityName", () => {
  it("returns a valid city name", () => {
    const name = pickCityName([]);
    expect(CITIES).toContain(name);
  });

  it("never returns a name from the excluded list", () => {
    const excluded = ["tokyo", "berlin", "lagos"];
    for (let i = 0; i < 50; i++) {
      const name = pickCityName(excluded);
      expect(excluded).not.toContain(name);
    }
  });

  it("suffixes -1 when every plain city is used", () => {
    const name = pickCityName([...CITIES]);
    expect(name).toMatch(/^[a-z]+-1$/);
    expect(CITIES).toContain(name.slice(0, -2));
  });

  it("picks the smallest free suffix", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const used = [...CITIES, `${CITIES[0]}-1`, `${CITIES[0]}-2`, `${CITIES[0]}-4`];
      expect(pickCityName(used)).toBe(`${CITIES[0]}-3`);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("never suffixes while a plain city is free", () => {
    const [free, ...rest] = CITIES;
    expect(pickCityName([...rest, `${free}-1`])).toBe(free);
  });

  it("only exposes ASCII-safe filesystem slugs", () => {
    for (const city of CITIES) {
      expect(city).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("returns different names across multiple calls", () => {
    const names = new Set<string>();
    for (let i = 0; i < 20; i++) {
      names.add(pickCityName([]));
    }
    // With 190+ cities and 20 picks, we should get at least 2 unique names
    expect(names.size).toBeGreaterThan(1);
  });
});
