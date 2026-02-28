import { describe, expect, it } from "vitest";
import {
  isAskUserQuestion,
  isExitPlanMode,
  parseQuestions,
  parseTabId,
  tabId,
  type ToolCall,
} from "@/types";

function tool(overrides: Partial<ToolCall>): ToolCall {
  return {
    id: "tool-1",
    name: "Unknown",
    input: "{}",
    ...overrides,
  };
}

describe("tool type helpers", () => {
  it("detects AskUserQuestion tools with valid payload", () => {
    const value = tool({
      name: "AskUserQuestion",
      input: JSON.stringify({
        questions: [{ question: "Q?", options: [{ label: "A" }] }],
      }),
    });

    expect(isAskUserQuestion(value)).toBe(true);
  });

  it("returns false for malformed AskUserQuestion payload", () => {
    const value = tool({ name: "AskUserQuestion", input: "{not-json" });
    expect(isAskUserQuestion(value)).toBe(false);
  });

  it("detects ExitPlanMode tools", () => {
    expect(isExitPlanMode(tool({ name: "ExitPlanMode" }))).toBe(true);
    expect(isExitPlanMode(tool({ name: "Bash" }))).toBe(false);
  });

  it("parses questions safely", () => {
    const parsed = parseQuestions(
      tool({
        name: "AskUserQuestion",
        input: JSON.stringify({
          questions: [{ question: "Pick one", options: [{ label: "Yes" }] }],
        }),
      }),
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.question).toBe("Pick one");
  });

  it("returns empty array for invalid question payload", () => {
    expect(parseQuestions(tool({ input: "oops" }))).toEqual([]);
  });
});

describe("tab helpers", () => {
  it("builds and parses session tab IDs", () => {
    const id = tabId({ type: "session", sessionId: "sess-1" });
    expect(id).toBe("session:sess-1");
    expect(parseTabId(id)).toEqual({ type: "session", sessionId: "sess-1" });
  });

  it("builds and parses file tab IDs", () => {
    const id = tabId({ type: "file", path: "src/index.ts" });
    expect(id).toBe("file:src/index.ts");
    expect(parseTabId(id)).toEqual({ type: "file", path: "src/index.ts" });
  });
});
