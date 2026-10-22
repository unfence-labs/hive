import { describe, expect, it } from "vitest";
import { MAX_AGENT_OUTPUT_CHARS, normalizeToolOutput } from "./bounded-output.js";

describe("normalizeToolOutput", () => {
  it("bounds the combined text from content blocks", () => {
    const result = normalizeToolOutput([
      { type: "text", text: "x".repeat(MAX_AGENT_OUTPUT_CHARS) },
      { type: "text", text: "Final result" },
    ]);
    expect(result.length).toBeLessThanOrEqual(MAX_AGENT_OUTPUT_CHARS);
    expect(result).toContain("Output truncated by Hive");
    expect(result.endsWith("Final result")).toBe(true);
  });

  it("preserves ordinary strings, structured results and tool references", () => {
    expect(normalizeToolOutput("plain text")).toBe("plain text");
    expect(normalizeToolOutput({ exit_code: 1 })).toBe('{"exit_code":1}');
    expect(normalizeToolOutput([{ type: "tool_reference", tool_name: "Read" }]))
      .toBe('{"type":"tool_reference","tool_name":"Read"}');
    expect(normalizeToolOutput([])).toBe("");
    expect(normalizeToolOutput(null)).toBe("");
  });
});
