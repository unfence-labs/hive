import { describe, it, expect } from "vitest";
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

  it("throws when all names are exhausted", () => {
    expect(() => pickCityName([...CITIES])).toThrow("All city names exhausted");
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
