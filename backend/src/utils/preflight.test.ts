import { describe, it, expect } from "vitest";
import { meetsMinVersion } from "./preflight.js";

describe("meetsMinVersion()", () => {
  it("accepts exact match", () => {
    expect(meetsMinVersion("2.17.0", [2, 17])).toBe(true);
  });

  it("accepts higher minor", () => {
    expect(meetsMinVersion("2.40.1", [2, 17])).toBe(true);
  });

  it("accepts higher major", () => {
    expect(meetsMinVersion("3.0.0", [2, 17])).toBe(true);
  });

  it("rejects lower minor", () => {
    expect(meetsMinVersion("2.16.5", [2, 17])).toBe(false);
  });

  it("rejects lower major", () => {
    expect(meetsMinVersion("1.99.0", [2, 17])).toBe(false);
  });
});
