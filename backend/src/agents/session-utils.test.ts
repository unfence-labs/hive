import { describe, expect, it } from "vitest";
import { outputByteLength, outputLineCount } from "@hive/shared/agent-activity";
import { computeTruncatedField, OUTPUT_PREVIEW_BYTES } from "./session-utils.js";

// The line-count / byte-length formulas live in @hive/shared so the backend
// (computeTruncatedField) and the frontend (computeOutputScalars) cannot drift.
// These cases pin the shared primitives and confirm the backend reads them.

/** Representative inputs shared with the frontend parity test and the iOS copy. */
const CASES: Array<{ name: string; input: string; lines: number; bytes: number }> = [
  { name: "empty string", input: "", lines: 0, bytes: 0 },
  { name: "single line, no newline", input: "hello", lines: 1, bytes: 5 },
  { name: "multi-line", input: "a\nb\nc", lines: 3, bytes: 5 },
  { name: "trailing newline", input: "a\n", lines: 2, bytes: 2 },
  // "héllo" + emoji: 2-byte é + 4-byte 🚀 → byte length exceeds char length.
  { name: "multibyte", input: "héllo 🚀", lines: 1, bytes: 11 },
];

describe("shared output scalar primitives", () => {
  for (const { name, input, lines, bytes } of CASES) {
    it(`computes line count and byte length for ${name}`, () => {
      expect(outputLineCount(input)).toBe(lines);
      expect(outputByteLength(input)).toBe(bytes);
    });
  }

  it("computeTruncatedField derives its scalars from the shared primitives", () => {
    for (const { input } of CASES) {
      const field = computeTruncatedField(input);
      expect(field.lineCount).toBe(outputLineCount(input));
      expect(field.byteLength).toBe(outputByteLength(input));
    }
  });

  it("keeps the full body when under the preview cap", () => {
    const small = "a\nb";
    const field = computeTruncatedField(small);
    expect(field.truncated).toBe(false);
    expect(field.preview).toBe(small);
    expect(field.byteLength).toBeLessThanOrEqual(OUTPUT_PREVIEW_BYTES);
  });
});
