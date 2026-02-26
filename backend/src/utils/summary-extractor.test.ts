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

describe("extractSummaryFromText", () => {
  it("extracts summary between ## Summary and next heading", () => {
    const text = "Some text\n## Summary\nThis is the summary.\n## Next Section\nMore text";
    expect(extractSummaryFromText(text)).toBe("This is the summary.");
  });

  it("extracts summary until end of message", () => {
    const text = "Some text\n## Summary\nFinal summary here.";
    expect(extractSummaryFromText(text)).toBe("Final summary here.");
  });

  it("returns undefined when no summary section exists", () => {
    expect(extractSummaryFromText("Just some text without summary")).toBeUndefined();
  });

  it("returns undefined for empty summary section", () => {
    const text = "## Summary\n\n## Next";
    expect(extractSummaryFromText(text)).toBeUndefined();
  });

  it("handles multiline summary", () => {
    const text = "## Summary\nLine 1\nLine 2\nLine 3\n## Next";
    expect(extractSummaryFromText(text)).toBe("Line 1\nLine 2\nLine 3");
  });

  it("stops at # heading too", () => {
    const text = "## Summary\nSummary text\n# Top level heading";
    expect(extractSummaryFromText(text)).toBe("Summary text");
  });
});

describe("extractSummary", () => {
  it("finds summary in last assistant message", () => {
    const messages = [
      msg("user", "Do something"),
      msg("assistant", "Working...\n## Summary\nDone!"),
    ];
    expect(extractSummary(messages)).toBe("Done!");
  });

  it("uses the last assistant message, not the first", () => {
    const messages = [
      msg("assistant", "## Summary\nOld summary"),
      msg("user", "Continue"),
      msg("assistant", "## Summary\nNew summary"),
    ];
    expect(extractSummary(messages)).toBe("New summary");
  });

  it("returns undefined when no assistant messages exist", () => {
    const messages = [msg("user", "Hello")];
    expect(extractSummary(messages)).toBeUndefined();
  });

  it("returns undefined when assistant has no summary", () => {
    const messages = [msg("assistant", "Just text, no summary")];
    expect(extractSummary(messages)).toBeUndefined();
  });
});
