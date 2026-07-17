import { describe, expect, it } from "vitest";
import { encodeQr } from "@/lib/qr";

/**
 * We don't decode QR here; we assert the structural invariants that a valid QR
 * matrix must satisfy (finder patterns, size, versioning) so a regression in
 * the encoder is caught.
 */
function hasFinderPattern(modules: boolean[][], row: number, col: number): boolean {
  // The 7x7 finder: outer 5x5 ring dark border, dark 3x3 center.
  const dark = (r: number, c: number) => modules[row + r]?.[col + c] === true;
  // Corners of the outer ring dark.
  return dark(0, 0) && dark(0, 6) && dark(6, 0) && dark(6, 6) && dark(3, 3);
}

describe("encodeQr", () => {
  it("produces a square matrix with a valid version size", () => {
    const { size, modules } = encodeQr("hive://pair?v=1&host=100.1.2.3&port=3000&token=hive_abc");
    expect(modules.length).toBe(size);
    expect(modules.every((row) => row.length === size)).toBe(true);
    // Version 1 is 21; sizes grow by 4. Must be 4*v+17.
    expect((size - 17) % 4).toBe(0);
  });

  it("places the three finder patterns", () => {
    const { size, modules } = encodeQr("hive://pair?v=1&host=h&port=3000&token=t");
    expect(hasFinderPattern(modules, 0, 0)).toBe(true); // top-left
    expect(hasFinderPattern(modules, 0, size - 7)).toBe(true); // top-right
    expect(hasFinderPattern(modules, size - 7, 0)).toBe(true); // bottom-left
  });

  it("is deterministic for the same input", () => {
    const a = encodeQr("stable-input");
    const b = encodeQr("stable-input");
    expect(a.modules).toEqual(b.modules);
  });

  it("grows the version for longer payloads", () => {
    const short = encodeQr("x");
    const long = encodeQr("x".repeat(120));
    expect(long.size).toBeGreaterThan(short.size);
  });

  it("throws when the payload exceeds supported capacity", () => {
    expect(() => encodeQr("y".repeat(1000))).toThrow();
  });
});
