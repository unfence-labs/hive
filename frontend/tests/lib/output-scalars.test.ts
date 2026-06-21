import { describe, expect, it } from "vitest";
import { outputByteLength, outputLineCount } from "@hive/shared/agent-activity";

// The frontend's computeOutputScalars (useConversation) and the backend's
// computeTruncatedField (session-utils) both read these shared primitives, so
// the line-count / byte-length formulas cannot drift between packages. These
// CASES mirror backend/src/agents/session-utils.test.ts byte-for-byte.
const CASES: Array<{ name: string; input: string; lines: number; bytes: number }> = [
  { name: "empty string", input: "", lines: 0, bytes: 0 },
  { name: "single line, no newline", input: "hello", lines: 1, bytes: 5 },
  { name: "multi-line", input: "a\nb\nc", lines: 3, bytes: 5 },
  // A single trailing newline must NOT inflate the count (command/Grep output
  // almost always ends in one). "a\n" is one line, not two.
  { name: "trailing newline ignored", input: "a\n", lines: 1, bytes: 2 },
  { name: "single char", input: "a", lines: 1, bytes: 1 },
  { name: "two lines, no trailing newline", input: "a\nb", lines: 2, bytes: 3 },
  { name: "two lines, trailing newline", input: "a\nb\n", lines: 2, bytes: 4 },
  { name: "lone newline", input: "\n", lines: 0, bytes: 1 },
  { name: "trailing blank line preserved", input: "a\n\n", lines: 2, bytes: 3 },
  { name: "multibyte", input: "héllo 🚀", lines: 1, bytes: 11 },
];

describe("shared output scalar primitives (frontend)", () => {
  for (const { name, input, lines, bytes } of CASES) {
    it(`computes line count and byte length for ${name}`, () => {
      expect(outputLineCount(input)).toBe(lines);
      expect(outputByteLength(input)).toBe(bytes);
    });
  }
});
