/**
 * Extended summary extractor tests: tricky markdown, whitespace,
 * edge cases around headings, and content block handling.
 */
import { describe, it, expect } from "vitest";
import { extractSummary, extractSummaryFromText } from "./summary-extractor.js";
import type { ChatMessage } from "../types.js";

function msg(role: "user" | "assistant", content: string): ChatMessage {
  return {
    id: "msg-1",
    sessionId: "sess-1",
    role,
    content,
    timestamp: new Date().toISOString(),
  };
}

describe("extractSummaryFromText - extended", () => {
  it("handles tabs before heading newline", () => {
    const text = "## Summary\t\nTabbed content";
    expect(extractSummaryFromText(text)).toBe("Tabbed content");
  });

  it("handles spaces before heading newline", () => {
    const text = "## Summary   \nSpaced content";
    expect(extractSummaryFromText(text)).toBe("Spaced content");
  });

  it("extracts until ### subheading", () => {
    // ### is not ## or #, so it should be included in the summary
    const text = "## Summary\nLine 1\n### Subheading\nLine 2\n## Next";
    expect(extractSummaryFromText(text)).toBe("Line 1\n### Subheading\nLine 2");
  });

  it("handles summary at very start of text", () => {
    const text = "## Summary\nFirst line";
    expect(extractSummaryFromText(text)).toBe("First line");
  });

  it("handles summary with bullet points", () => {
    const text = "## Summary\n- Found 3 bugs\n- Fixed 2 of them\n- 1 remains\n## Next Steps";
    expect(extractSummaryFromText(text)).toBe("- Found 3 bugs\n- Fixed 2 of them\n- 1 remains");
  });

  it("handles summary with code blocks", () => {
    const text = "## Summary\nFixed the bug:\n```js\nconst x = 1;\n```\n## Details";
    expect(extractSummaryFromText(text)).toBe("Fixed the bug:\n```js\nconst x = 1;\n```");
  });

  it("does not match headings without space: ##Summary", () => {
    const text = "##Summary\nNo space after hashes";
    // The regex requires a space after ##, so this should not match
    expect(extractSummaryFromText(text)).toBeUndefined();
  });

  it("handles multiple ## Summary sections (takes first)", () => {
    const text = "## Summary\nFirst\n## Other\n## Summary\nSecond";
    // regex.match returns the first match
    expect(extractSummaryFromText(text)).toBe("First");
  });

  it("does not match Windows-style \\r\\n (regex expects \\n only)", () => {
    const text = "## Summary\r\nWindows line\r\n## Next";
    // The regex uses [ \t]*\n which doesn't match \r before \n
    expect(extractSummaryFromText(text)).toBeUndefined();
  });

  it("captures content when heading follows on next line without blank line", () => {
    // "## Summary\n## Another Heading" — captured as content because
    // the lookahead \n## requires a newline before ## that isn't there at $
    const text = "## Summary\n## Another Heading";
    expect(extractSummaryFromText(text)).toBe("## Another Heading");
  });

  it("returns undefined when heading follows after blank line", () => {
    const text = "## Summary\n\n## Another Heading";
    expect(extractSummaryFromText(text)).toBeUndefined();
  });

  it("handles summary with only whitespace content", () => {
    const text = "## Summary\n   \n  \n## Next";
    expect(extractSummaryFromText(text)).toBeUndefined();
  });

  it("handles deeply nested content after summary", () => {
    const text = "## Summary\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5";
    expect(extractSummaryFromText(text)).toBe("Line 1\nLine 2\nLine 3\nLine 4\nLine 5");
  });

  it("stops at # top-level heading", () => {
    const text = "## Summary\nSome text\n# Top Level\nMore text";
    expect(extractSummaryFromText(text)).toBe("Some text");
  });

  it("handles empty text", () => {
    expect(extractSummaryFromText("")).toBeUndefined();
  });

  it("handles text with no headings at all", () => {
    expect(extractSummaryFromText("Just plain text\nwith lines")).toBeUndefined();
  });
});

describe("extractSummary - extended", () => {
  it("returns undefined for empty message list", () => {
    expect(extractSummary([])).toBeUndefined();
  });

  it("skips user messages", () => {
    const messages = [
      msg("user", "## Summary\nUser summary should be ignored"),
    ];
    expect(extractSummary(messages)).toBeUndefined();
  });

  it("handles mixed messages with summary only in last assistant message", () => {
    const messages = [
      msg("user", "Do task A"),
      msg("assistant", "Working on A..."),
      msg("user", "Now do task B"),
      msg("assistant", "Done!\n## Summary\nCompleted tasks A and B"),
    ];
    expect(extractSummary(messages)).toBe("Completed tasks A and B");
  });

  it("ignores summary in non-last assistant message", () => {
    const messages = [
      msg("assistant", "## Summary\nOld summary"),
      msg("user", "Continue"),
      msg("assistant", "No summary here"),
    ];
    // The last assistant message has no summary
    expect(extractSummary(messages)).toBeUndefined();
  });

  it("handles many messages efficiently", () => {
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 100; i++) {
      messages.push(msg("user", `Question ${i}`));
      messages.push(msg("assistant", `Answer ${i}`));
    }
    messages.push(msg("assistant", "## Summary\nFinal summary"));

    expect(extractSummary(messages)).toBe("Final summary");
  });
});
