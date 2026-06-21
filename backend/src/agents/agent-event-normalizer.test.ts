import { describe, expect, it } from "vitest";
import { AgentEventNormalizer } from "./agent-event-normalizer.js";
import type { CliJsonLine } from "../types.js";

function assistant(content: Extract<CliJsonLine, { type: "assistant" }>["message"]["content"], usage?: Extract<CliJsonLine, { type: "assistant" }>["message"]["usage"]): Extract<CliJsonLine, { type: "assistant" }> {
  return {
    type: "assistant",
    message: {
      id: "msg-1",
      role: "assistant",
      content,
      usage,
    },
  };
}

function user(content: Extract<CliJsonLine, { type: "user" }>["message"]["content"]): Extract<CliJsonLine, { type: "user" }> {
  return {
    type: "user",
    message: {
      role: "user",
      content,
    },
  };
}

describe("AgentEventNormalizer", () => {
  it("normalizes text, tool starts, and usage", () => {
    const normalizer = new AgentEventNormalizer();

    const events = normalizer.handleAssistant(assistant([
      { type: "text", text: "Hello" },
      { type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "a.ts" } },
    ], {
      input_tokens: 10,
      cache_read_input_tokens: 4,
      output_tokens: 2,
    }));

    expect(events).toEqual([
      { type: "text_delta", text: "Hello" },
      {
        type: "tool_started",
        id: "tool-1",
        name: "Read",
        rawName: "Read",
        input: JSON.stringify({ file_path: "a.ts" }, null, 2),
        parentToolUseId: undefined,
      },
      { type: "usage_updated", inputTokens: 14, outputTokens: 2 },
    ]);
  });

  it("normalizes duplicate tool blocks as updates", () => {
    const normalizer = new AgentEventNormalizer();

    normalizer.handleAssistant(assistant([
      { type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "a.ts" } },
    ]));
    const events = normalizer.handleAssistant(assistant([
      { type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "b.ts" } },
    ]));

    expect(events).toEqual([
      { type: "tool_updated", id: "tool-1", input: JSON.stringify({ file_path: "b.ts" }, null, 2) },
    ]);
  });

  it("tracks task parentage until the task result arrives", () => {
    const normalizer = new AgentEventNormalizer();

    normalizer.handleAssistant(assistant([
      { type: "tool_use", id: "task-1", name: "Task", input: { prompt: "inspect" } },
    ]));
    const childEvents = normalizer.handleAssistant(assistant([
      { type: "tool_use", id: "read-1", name: "Read", input: { file_path: "a.ts" } },
    ]));
    normalizer.handleUser(user([
      { type: "tool_result", tool_use_id: "task-1", content: "done" },
    ]));
    const nextEvents = normalizer.handleAssistant(assistant([
      { type: "tool_use", id: "read-2", name: "Read", input: { file_path: "b.ts" } },
    ]));

    expect(childEvents[0]).toMatchObject({ type: "tool_started", parentToolUseId: "task-1" });
    expect(nextEvents[0]).toMatchObject({ type: "tool_started", parentToolUseId: undefined });
  });

  it("preserves explicit tool parentage from provider adapters", () => {
    const normalizer = new AgentEventNormalizer();

    const events = normalizer.handleAssistant(assistant([
      { type: "tool_use", id: "child-1", name: "Bash", input: { command: "npm test" }, parentToolUseId: "agent-1" },
    ]));

    expect(events).toEqual([
      expect.objectContaining({
        type: "tool_started",
        id: "child-1",
        name: "Bash",
        parentToolUseId: "agent-1",
      }),
    ]);
  });

  it("normalizes server tool results as tool completions", () => {
    const normalizer = new AgentEventNormalizer();

    const events = normalizer.handleAssistant(assistant([
      {
        type: "bash_code_execution_tool_result",
        tool_use_id: "bash-1",
        content: { stdout: "ok", stderr: "warn", return_code: 1 },
      },
    ]));

    expect(events).toEqual([
      { type: "tool_completed", id: "bash-1", output: "ok\nstderr: warn\nexit code: 1" },
    ]);
  });

  it("normalizes structured user tool result content as text", () => {
    const normalizer = new AgentEventNormalizer();

    const events = normalizer.handleUser(user([
      {
        type: "tool_result",
        tool_use_id: "tool-1",
        content: [
          { type: "text", text: "first block" },
          { type: "text", text: "second block" },
        ],
      },
    ]));

    expect(events).toEqual([
      { type: "tool_completed", id: "tool-1", output: "first block\n\nsecond block" },
    ]);
  });
});
