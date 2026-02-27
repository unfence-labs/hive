import { describe, expect, it } from "vitest";
import {
  findPlanContent,
  getFallbackInteractiveAssistantIndex,
  hasExitPlanModeTool,
  hasPendingExitPlanModeInput,
  isPlanFileTool,
  isPlanAwaitingUserInput,
  stripLineNumbers,
} from "@/lib/plan-state";
import type { ChatMessage, ToolCall } from "@/types";

function userMessage(id: string): ChatMessage {
  return {
    id,
    sessionId: "sess-1",
    role: "user",
    content: "hello",
    timestamp: "2026-02-20T00:00:00.000Z",
  };
}

function assistantMessage(id: string, withPlanTool = false): ChatMessage {
  return {
    id,
    sessionId: "sess-1",
    role: "assistant",
    content: "response",
    timestamp: "2026-02-20T00:00:01.000Z",
    toolCalls: withPlanTool
      ? [{ id: "tool-plan", name: "ExitPlanMode", input: "{}" }]
      : undefined,
  };
}

function toolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: "tool-1",
    name: "Read",
    input: "{}",
    ...overrides,
  };
}

describe("plan-state helpers", () => {
  it("detects ExitPlanMode tool calls", () => {
    expect(hasExitPlanModeTool(assistantMessage("a1", true))).toBe(true);
    expect(hasExitPlanModeTool(assistantMessage("a2", false))).toBe(false);
    expect(hasExitPlanModeTool(undefined)).toBe(false);
  });

  it("detects explicit pending ExitPlanMode inputs", () => {
    expect(hasPendingExitPlanModeInput([{ toolName: "AskUserQuestion" }])).toBe(false);
    expect(hasPendingExitPlanModeInput([{ toolName: "ExitPlanMode" }])).toBe(true);
  });

  it("returns -1 for fallback interactive assistant index while streaming", () => {
    const idx = getFallbackInteractiveAssistantIndex([assistantMessage("a1", true)], true);
    expect(idx).toBe(-1);
  });

  it("returns last assistant index when no user message comes after it", () => {
    const messages = [userMessage("u1"), assistantMessage("a1", false), assistantMessage("a2", true)];
    const idx = getFallbackInteractiveAssistantIndex(messages, false);
    expect(idx).toBe(2);
  });

  it("returns -1 when a user message appears after the last assistant", () => {
    const messages = [assistantMessage("a1", true), userMessage("u1")];
    const idx = getFallbackInteractiveAssistantIndex(messages, false);
    expect(idx).toBe(-1);
  });

  it("considers plan pending when explicit ExitPlanMode input exists", () => {
    const pending = isPlanAwaitingUserInput({
      messages: [assistantMessage("a1", false)],
      isStreaming: true,
      pendingToolInputs: [{ toolName: "ExitPlanMode" }],
    });
    expect(pending).toBe(true);
  });

  it("falls back to last interactive assistant plan tool when no pending input exists", () => {
    const pending = isPlanAwaitingUserInput({
      messages: [userMessage("u1"), assistantMessage("a1", true)],
      isStreaming: false,
      pendingToolInputs: [],
    });
    expect(pending).toBe(true);
  });

  it("returns false when there is no pending input and no interactive plan tool", () => {
    const pending = isPlanAwaitingUserInput({
      messages: [assistantMessage("a1", false)],
      isStreaming: false,
      pendingToolInputs: [],
    });
    expect(pending).toBe(false);
  });
});

describe("plan-state plan content extraction", () => {
  it("detects plan file tools by name and path", () => {
    expect(
      isPlanFileTool(
        toolCall({
          name: "Write",
          input: JSON.stringify({ file_path: ".claude/plans/feature.md" }),
        }),
        "Write",
      ),
    ).toBe(true);
    expect(
      isPlanFileTool(
        toolCall({
          name: "Write",
          input: JSON.stringify({ file_path: ".claude/plans/feature.md" }),
        }),
        "Read",
      ),
    ).toBe(false);
    expect(isPlanFileTool(toolCall({ name: "Write", input: "{bad" }), "Write")).toBe(false);
  });

  it("strips line numbers when Read output is prefixed with tab or arrow separators", () => {
    expect(stripLineNumbers("1\t# Plan\n2\t- A")).toBe("# Plan\n- A");
    expect(stripLineNumbers("  10→alpha\n11→beta")).toBe("alpha\nbeta");
    expect(stripLineNumbers("# Title\n2\t- Keep")).toBe("# Title\n2\t- Keep");
  });

  it("prefers the latest .claude/plans Write tool and returns write tool id", () => {
    const result = findPlanContent([
      toolCall({
        id: "write-old",
        name: "Write",
        input: JSON.stringify({
          file_path: ".claude/plans/old.md",
          content: "old content",
        }),
      }),
      toolCall({
        id: "write-new",
        name: "Write",
        input: JSON.stringify({
          file_path: ".claude/plans/new.md",
          content: "new content",
        }),
      }),
    ]);

    expect(result).toEqual({
      content: "new content",
      writeToolId: "write-new",
      planPath: ".claude/plans/new.md",
    });
  });

  it("reconstructs plan content from Read + Edit flow", () => {
    const result = findPlanContent([
      toolCall({
        id: "read-1",
        name: "Read",
        input: JSON.stringify({ file_path: ".claude/plans/feature.md" }),
        output: "1\t# Plan\n2\t- step alpha\n3\t- step alpha\n",
      }),
      toolCall({
        id: "edit-1",
        name: "Edit",
        input: JSON.stringify({
          file_path: ".claude/plans/feature.md",
          old_string: "alpha",
          new_string: "beta",
          replace_all: true,
        }),
      }),
    ]);

    expect(result).toEqual({
      content: "# Plan\n- step beta\n- step beta\n",
      planPath: ".claude/plans/feature.md",
    });
  });

  it("uses latest matching Read output and applies only same-path edits", () => {
    const result = findPlanContent([
      toolCall({
        id: "read-old",
        name: "Read",
        input: JSON.stringify({ file_path: ".claude/plans/feature.md" }),
        output: "1\t- old",
      }),
      toolCall({
        id: "read-new",
        name: "Read",
        input: JSON.stringify({ file_path: ".claude/plans/feature.md" }),
        output: "1\t- original",
      }),
      toolCall({
        id: "edit-other-file",
        name: "Edit",
        input: JSON.stringify({
          file_path: ".claude/plans/other.md",
          old_string: "original",
          new_string: "wrong",
        }),
      }),
      toolCall({
        id: "edit-plan",
        name: "Edit",
        input: JSON.stringify({
          file_path: ".claude/plans/feature.md",
          old_string: "original",
          new_string: "updated",
        }),
      }),
    ]);

    expect(result).toEqual({
      content: "- updated",
      planPath: ".claude/plans/feature.md",
    });
  });

  it("falls back to ExitPlanMode input when no write/edit content is available", () => {
    const result = findPlanContent([
      toolCall({
        id: "exit-1",
        name: "ExitPlanMode",
        input: JSON.stringify({
          plan: "finalized plan",
          file_path: ".claude/plans/final.md",
        }),
      }),
    ]);

    expect(result).toEqual({
      content: "finalized plan",
      planPath: ".claude/plans/final.md",
    });
  });

  it("falls back to the latest markdown Write when ExitPlanMode plan is blank", () => {
    const result = findPlanContent([
      toolCall({
        id: "write-doc",
        name: "Write",
        input: JSON.stringify({
          file_path: "docs/implementation-plan.md",
          content: "doc plan",
        }),
      }),
      toolCall({
        id: "exit-blank",
        name: "ExitPlanMode",
        input: JSON.stringify({ plan: "  " }),
      }),
    ]);

    expect(result).toEqual({
      content: "doc plan",
      writeToolId: "write-doc",
      planPath: "docs/implementation-plan.md",
    });
  });

  it("returns undefined when no extraction strategy yields plan content", () => {
    expect(findPlanContent([])).toBeUndefined();
    expect(
      findPlanContent([
        toolCall({
          id: "write-empty",
          name: "Write",
          input: JSON.stringify({
            file_path: "docs/implementation-plan.md",
            content: "   ",
          }),
        }),
      ]),
    ).toBeUndefined();
  });
});
