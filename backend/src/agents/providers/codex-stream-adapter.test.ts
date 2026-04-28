import { describe, it, expect, beforeEach, vi } from "vitest";
import { CodexStreamAdapter } from "./codex-stream-adapter.js";
import type { StreamParserEvent } from "../stream-parser.js";

function line(obj: Record<string, unknown>): string {
  return JSON.stringify(obj) + "\n";
}

describe("CodexStreamAdapter", () => {
  let adapter: CodexStreamAdapter;

  beforeEach(() => {
    adapter = new CodexStreamAdapter();
  });

  // ── Basic line parsing ─────────────────────────────────────────────

  it("captures thread ID from thread.started event", () => {
    adapter.write(line({ type: "thread.started", thread_id: "thread-abc" }));
    expect(adapter.capturedThreadId).toBe("thread-abc");
  });

  it("emits nothing for turn.started", () => {
    const spy = vi.fn();
    adapter.on("assistant", spy);
    adapter.on("result", spy);
    adapter.on("error", spy);

    adapter.write(line({ type: "turn.started" }));
    expect(spy).not.toHaveBeenCalled();
  });

  // ── Agent messages ─────────────────────────────────────────────────

  it("emits assistant text on item.completed for agent_message", () => {
    const messages: StreamParserEvent["assistant"][] = [];
    adapter.on("assistant", (...args) => messages.push(args));

    adapter.write(line({
      type: "item.completed",
      item: { id: "msg-1", type: "agent_message", text: "Hello world" },
    }));

    expect(messages).toHaveLength(1);
    const [data] = messages[0];
    expect(data.type).toBe("assistant");
    expect(data.message.content).toEqual([{ type: "text", text: "Hello world" }]);
  });

  it("accumulates text fragments across item.started and item.updated", () => {
    const messages: StreamParserEvent["assistant"][] = [];
    adapter.on("assistant", (...args) => messages.push(args));

    adapter.write(line({
      type: "item.started",
      item: { id: "msg-1", type: "agent_message", text: "Hello " },
    }));
    adapter.write(line({
      type: "item.updated",
      item: { id: "msg-1", type: "agent_message", text: "world" },
    }));
    // started and updated don't flush for agent_message
    expect(messages).toHaveLength(0);

    adapter.write(line({
      type: "item.completed",
      item: { id: "msg-1", type: "agent_message", text: "!" },
    }));

    // Flush should combine all parts
    expect(messages).toHaveLength(1);
    const [data] = messages[0];
    expect(data.message.content).toEqual([{ type: "text", text: "Hello world!" }]);
  });

  // ── Reasoning / thinking ───────────────────────────────────────────

  it("emits thinking content on item.completed for reasoning", () => {
    const messages: StreamParserEvent["assistant"][] = [];
    adapter.on("assistant", (...args) => messages.push(args));

    adapter.write(line({
      type: "item.completed",
      item: { id: "think-1", type: "reasoning", text: "Let me think about this" },
    }));

    expect(messages).toHaveLength(1);
    const [data] = messages[0];
    expect(data.message.content).toEqual([{ type: "thinking", thinking: "Let me think about this" }]);
  });

  it("accumulates thinking parts", () => {
    const messages: StreamParserEvent["assistant"][] = [];
    adapter.on("assistant", (...args) => messages.push(args));

    adapter.write(line({
      type: "item.started",
      item: { id: "think-1", type: "reasoning", text: "Part 1 " },
    }));
    adapter.write(line({
      type: "item.completed",
      item: { id: "think-1", type: "reasoning", text: "Part 2" },
    }));

    expect(messages).toHaveLength(1);
    const [data] = messages[0];
    expect(data.message.content).toEqual([{ type: "thinking", thinking: "Part 1 Part 2" }]);
  });

  // ── Tool use: command_execution ────────────────────────────────────

  it("emits tool_use for command_execution on item.started", () => {
    const messages: StreamParserEvent["assistant"][] = [];
    adapter.on("assistant", (...args) => messages.push(args));

    adapter.write(line({
      type: "item.started",
      item: { id: "cmd-1", type: "command_execution", command: "ls -la" },
    }));

    expect(messages).toHaveLength(1);
    const [data] = messages[0];
    expect(data.message.content[0]).toEqual({
      type: "tool_use",
      id: "cmd-1",
      name: "Bash",
      input: JSON.stringify({ command: "ls -la" }),
    });
  });

  it("emits tool_use and tool_result for command_execution on item.completed", () => {
    const assistantMsgs: StreamParserEvent["assistant"][] = [];
    const userMsgs: StreamParserEvent["user"][] = [];
    adapter.on("assistant", (...args) => assistantMsgs.push(args));
    adapter.on("user", (...args) => userMsgs.push(args));

    adapter.write(line({
      type: "item.completed",
      item: { id: "cmd-1", type: "command_execution", command: "echo hi", output: "hi\n", exit_code: 0 },
    }));

    // Should emit tool_use
    expect(assistantMsgs).toHaveLength(1);
    expect(assistantMsgs[0][0].message.content[0]).toMatchObject({
      type: "tool_use",
      name: "Bash",
    });

    // Should emit tool_result
    expect(userMsgs).toHaveLength(1);
    expect(userMsgs[0][0].message.content[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "cmd-1",
      content: "hi\n",
    });
  });

  it("uses official aggregated_output for command_execution results", () => {
    const userMsgs: StreamParserEvent["user"][] = [];
    adapter.on("user", (...args) => userMsgs.push(args));

    adapter.write(line({
      type: "item.completed",
      item: {
        id: "cmd-official",
        type: "command_execution",
        command: "printf hi",
        aggregated_output: "hi",
        exit_code: 0,
        status: "completed",
      },
    }));

    expect(userMsgs[0][0].message.content[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "cmd-official",
      content: "hi",
    });
  });

  it("uses exit code as fallback when command output is empty", () => {
    const userMsgs: StreamParserEvent["user"][] = [];
    adapter.on("user", (...args) => userMsgs.push(args));

    adapter.write(line({
      type: "item.completed",
      item: { id: "cmd-2", type: "command_execution", command: "false", exit_code: 1 },
    }));

    expect(userMsgs[0][0].message.content[0]).toMatchObject({
      content: "Exit code: 1",
    });
  });

  // ── Tool use: file_change ──────────────────────────────────────────

  it("emits Edit tool for file_change", () => {
    const assistantMsgs: StreamParserEvent["assistant"][] = [];
    const userMsgs: StreamParserEvent["user"][] = [];
    adapter.on("assistant", (...args) => assistantMsgs.push(args));
    adapter.on("user", (...args) => userMsgs.push(args));

    adapter.write(line({
      type: "item.completed",
      item: { id: "fc-1", type: "file_change", filename: "app.ts", diff: "+new line" },
    }));

    expect(assistantMsgs[0][0].message.content[0]).toMatchObject({
      type: "tool_use",
      name: "Edit",
      input: JSON.stringify({ filename: "app.ts", diff: "+new line" }),
    });
    expect(userMsgs[0][0].message.content[0]).toMatchObject({
      content: "+new line",
    });
  });

  it("uses 'File changed' fallback when diff is empty", () => {
    const userMsgs: StreamParserEvent["user"][] = [];
    adapter.on("user", (...args) => userMsgs.push(args));

    adapter.write(line({
      type: "item.completed",
      item: { id: "fc-2", type: "file_change", filename: "x.ts" },
    }));

    expect(userMsgs[0][0].message.content[0]).toMatchObject({
      content: "File changed",
    });
  });

  it("formats official file_change changes when no diff is present", () => {
    const assistantMsgs: StreamParserEvent["assistant"][] = [];
    const userMsgs: StreamParserEvent["user"][] = [];
    adapter.on("assistant", (...args) => assistantMsgs.push(args));
    adapter.on("user", (...args) => userMsgs.push(args));

    adapter.write(line({
      type: "item.completed",
      item: {
        id: "fc-official",
        type: "file_change",
        changes: [{ path: "src/app.ts", kind: "update" }],
        status: "completed",
      },
    }));

    const toolUse = assistantMsgs[0][0].message.content[0];
    expect(toolUse).toMatchObject({ type: "tool_use", name: "Edit" });
    expect(toolUse.type).toBe("tool_use");
    if (toolUse.type !== "tool_use") throw new Error("Expected tool_use block");
    expect(JSON.parse(String(toolUse.input))).toMatchObject({
      filename: "src/app.ts",
      changes: [{ path: "src/app.ts", kind: "update" }],
    });
    expect(userMsgs[0][0].message.content[0]).toMatchObject({
      content: "update: src/app.ts",
    });
  });

  it("waits for file_change details before emitting Edit tool input", () => {
    const assistantMsgs: StreamParserEvent["assistant"][] = [];
    const userMsgs: StreamParserEvent["user"][] = [];
    adapter.on("assistant", (...args) => assistantMsgs.push(args));
    adapter.on("user", (...args) => userMsgs.push(args));

    adapter.write(line({
      type: "item.started",
      item: {
        id: "fc-delayed",
        type: "file_change",
        status: "in_progress",
      },
    }));

    expect(assistantMsgs).toHaveLength(0);

    adapter.write(line({
      type: "item.completed",
      item: {
        id: "fc-delayed",
        type: "file_change",
        changes: [{ path: "src/app.ts", kind: "update" }],
        status: "completed",
      },
    }));

    expect(assistantMsgs).toHaveLength(1);
    const toolUse = assistantMsgs[0][0].message.content[0];
    expect(toolUse).toMatchObject({ type: "tool_use", name: "Edit" });
    expect(toolUse.type).toBe("tool_use");
    if (toolUse.type !== "tool_use") throw new Error("Expected tool_use block");
    expect(JSON.parse(String(toolUse.input))).toMatchObject({
      filename: "src/app.ts",
      changes: [{ path: "src/app.ts", kind: "update" }],
    });
    expect(userMsgs[0][0].message.content[0]).toMatchObject({
      content: "update: src/app.ts",
    });
  });

  // ── Tool use: web_search ───────────────────────────────────────────

  it("emits WebSearch tool for web_search items", () => {
    const assistantMsgs: StreamParserEvent["assistant"][] = [];
    adapter.on("assistant", (...args) => assistantMsgs.push(args));

    adapter.write(line({
      type: "item.started",
      item: { id: "ws-1", type: "web_search" },
    }));

    expect(assistantMsgs[0][0].message.content[0]).toMatchObject({
      name: "WebSearch",
    });
  });

  // ── Tool use: mcp_tool_call ────────────────────────────────────────

  it("emits mcp_tool_call tool for mcp items", () => {
    const assistantMsgs: StreamParserEvent["assistant"][] = [];
    adapter.on("assistant", (...args) => assistantMsgs.push(args));

    adapter.write(line({
      type: "item.started",
      item: { id: "mcp-1", type: "mcp_tool_call" },
    }));

    expect(assistantMsgs[0][0].message.content[0]).toMatchObject({
      name: "mcp_tool_call",
    });
  });

  it("emits a result for failed mcp tool call items", () => {
    const userMsgs: StreamParserEvent["user"][] = [];
    adapter.on("user", (...args) => userMsgs.push(args));

    adapter.write(line({
      type: "item.completed",
      item: {
        id: "mcp-failed",
        type: "mcp_tool_call",
        server: "docs",
        tool: "search",
        error: { message: "server unavailable" },
        status: "failed",
      },
    }));

    expect(userMsgs[0][0].message.content[0]).toMatchObject({
      tool_use_id: "mcp-failed",
      content: JSON.stringify({ message: "server unavailable" }, null, 2),
    });
  });

  // ── Codex native todo list ─────────────────────────────────────────

  it("emits TodoList tool updates for todo_list items", () => {
    const assistantMsgs: StreamParserEvent["assistant"][] = [];
    const userMsgs: StreamParserEvent["user"][] = [];
    adapter.on("assistant", (...args) => assistantMsgs.push(args));
    adapter.on("user", (...args) => userMsgs.push(args));

    const items = [
      { text: "Inspect logs", completed: true },
      { text: "Patch adapter", completed: false },
    ];

    adapter.write(line({
      type: "item.updated",
      item: { id: "todos-1", type: "todo_list", items },
    }));

    expect(assistantMsgs[0][0].message.content[0]).toMatchObject({
      type: "tool_use",
      id: "todos-1",
      name: "TodoList",
      input: JSON.stringify({ items }),
    });
    expect(userMsgs[0][0].message.content[0]).toMatchObject({
      tool_use_id: "todos-1",
      content: JSON.stringify({ items }),
    });
  });

  it("does not re-emit TodoList tool_use for repeated todo_list updates", () => {
    const assistantMsgs: StreamParserEvent["assistant"][] = [];
    const userMsgs: StreamParserEvent["user"][] = [];
    adapter.on("assistant", (...args) => assistantMsgs.push(args));
    adapter.on("user", (...args) => userMsgs.push(args));

    adapter.write(line({
      type: "item.started",
      item: { id: "todos-1", type: "todo_list", items: [{ text: "A", completed: false }] },
    }));
    adapter.write(line({
      type: "item.updated",
      item: { id: "todos-1", type: "todo_list", items: [{ text: "A", completed: true }] },
    }));

    expect(assistantMsgs).toHaveLength(1);
    expect(userMsgs).toHaveLength(2);
    expect(userMsgs[1][0].message.content[0]).toMatchObject({
      content: JSON.stringify({ items: [{ text: "A", completed: true }] }),
    });
  });

  // ── Item-level diagnostics ─────────────────────────────────────────

  it("emits item-level error as a non-fatal diagnostic tool", () => {
    const assistantMsgs: StreamParserEvent["assistant"][] = [];
    const userMsgs: StreamParserEvent["user"][] = [];
    const errors: Error[] = [];
    adapter.on("assistant", (...args) => assistantMsgs.push(args));
    adapter.on("user", (...args) => userMsgs.push(args));
    adapter.on("error", (err) => errors.push(err));

    adapter.write(line({
      type: "item.completed",
      item: { id: "err-1", type: "error", message: "Non-fatal tool issue" },
    }));

    expect(errors).toHaveLength(0);
    expect(assistantMsgs[0][0].message.content[0]).toMatchObject({
      type: "tool_use",
      id: "err-1",
      name: "CodexDiagnostic",
      input: JSON.stringify({ message: "Non-fatal tool issue" }),
    });
    expect(userMsgs[0][0].message.content[0]).toMatchObject({
      tool_use_id: "err-1",
      content: "Non-fatal tool issue",
    });
  });

  // ── Plan updates ───────────────────────────────────────────────────

  it("treats plan_update as text content", () => {
    const messages: StreamParserEvent["assistant"][] = [];
    adapter.on("assistant", (...args) => messages.push(args));

    adapter.write(line({
      type: "item.completed",
      item: { id: "plan-1", type: "plan_update", text: "Step 1: Setup" },
    }));

    expect(messages).toHaveLength(1);
    expect(messages[0][0].message.content).toEqual([{ type: "text", text: "Step 1: Setup" }]);
  });

  // ── Turn completion ────────────────────────────────────────────────

  it("emits result on turn.completed", () => {
    const results: StreamParserEvent["result"][] = [];
    adapter.on("result", (...args) => results.push(args));

    adapter.write(line({ type: "thread.started", thread_id: "thread-xyz" }));
    adapter.write(line({
      type: "turn.completed",
      usage: { input_tokens: 100, cached_input_tokens: 10, output_tokens: 50 },
    }));

    expect(results).toHaveLength(1);
    const [data] = results[0];
    expect(data.session_id).toBe("thread-xyz");
    expect(data.usage).toEqual({ input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10 });
  });

  it("emits result without usage when not provided", () => {
    const results: StreamParserEvent["result"][] = [];
    adapter.on("result", (...args) => results.push(args));

    adapter.write(line({ type: "turn.completed" }));

    expect(results).toHaveLength(1);
    expect(results[0][0].usage).toBeUndefined();
  });

  it("flushes pending text before turn.completed result", () => {
    const messages: StreamParserEvent["assistant"][] = [];
    const results: StreamParserEvent["result"][] = [];
    adapter.on("assistant", (...args) => messages.push(args));
    adapter.on("result", (...args) => results.push(args));

    adapter.write(line({
      type: "item.started",
      item: { id: "msg-1", type: "agent_message", text: "Buffered text" },
    }));
    adapter.write(line({ type: "turn.completed" }));

    // Text should have been flushed before the result
    expect(messages).toHaveLength(1);
    expect(results).toHaveLength(1);
  });

  it("flushes pending thinking before turn.completed result", () => {
    const messages: StreamParserEvent["assistant"][] = [];
    const results: StreamParserEvent["result"][] = [];
    adapter.on("assistant", (...args) => messages.push(args));
    adapter.on("result", (...args) => results.push(args));

    adapter.write(line({
      type: "item.started",
      item: { id: "think-1", type: "reasoning", text: "Buffered thinking" },
    }));
    adapter.write(line({ type: "turn.completed" }));

    expect(messages).toHaveLength(1);
    expect(messages[0][0].message.content).toEqual([{ type: "thinking", thinking: "Buffered thinking" }]);
    expect(results).toHaveLength(1);
  });

  // ── Turn failure ───────────────────────────────────────────────────

  it("emits error on turn.failed", () => {
    const errors: Error[] = [];
    adapter.on("error", (err) => errors.push(err));

    adapter.write(line({ type: "turn.failed", error: "Rate limit exceeded" }));

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("Rate limit exceeded");
  });

  it("reads official turn.failed error.message", () => {
    const errors: Error[] = [];
    adapter.on("error", (err) => errors.push(err));

    adapter.write(line({ type: "turn.failed", error: { message: "Usage limit reached" } }));

    expect(errors[0].message).toBe("Usage limit reached");
  });

  it("uses default message when turn.failed has no error", () => {
    const errors: Error[] = [];
    adapter.on("error", (err) => errors.push(err));

    adapter.write(line({ type: "turn.failed" }));

    expect(errors[0].message).toBe("Codex turn failed");
  });

  // ── Error events ───────────────────────────────────────────────────

  it("emits error for error event type", () => {
    const errors: Error[] = [];
    adapter.on("error", (err) => errors.push(err));

    adapter.write(line({ type: "error", error: "Something broke" }));

    expect(errors[0].message).toBe("Something broke");
  });

  it("uses message field as fallback for error", () => {
    const errors: Error[] = [];
    adapter.on("error", (err) => errors.push(err));

    adapter.write(line({ type: "error", message: "Fallback message" }));

    expect(errors[0].message).toBe("Fallback message");
  });

  it("uses generic message when error has no error or message", () => {
    const errors: Error[] = [];
    adapter.on("error", (err) => errors.push(err));

    adapter.write(line({ type: "error" }));

    expect(errors[0].message).toBe("Codex error");
  });

  // ── Malformed JSON ─────────────────────────────────────────────────

  it("emits error for malformed JSON lines", () => {
    const errors: Error[] = [];
    adapter.on("error", (err) => errors.push(err));

    adapter.write("not json\n");

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("Malformed Codex JSON line");
  });

  // ── Unknown event types ────────────────────────────────────────────

  it("does not crash on unknown event types", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    adapter.write(line({ type: "unknown.event" }));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("does not crash on unknown item types", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    adapter.write(line({
      type: "item.completed",
      item: { id: "x", type: "unknown_item_type" },
    }));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  // ── Line buffering ─────────────────────────────────────────────────

  it("handles partial lines across multiple writes", () => {
    const messages: StreamParserEvent["assistant"][] = [];
    adapter.on("assistant", (...args) => messages.push(args));

    const fullLine = JSON.stringify({
      type: "item.completed",
      item: { id: "msg-1", type: "agent_message", text: "Split" },
    });

    // Write in two parts
    const mid = Math.floor(fullLine.length / 2);
    adapter.write(fullLine.slice(0, mid));
    expect(messages).toHaveLength(0);

    adapter.write(fullLine.slice(mid) + "\n");
    expect(messages).toHaveLength(1);
  });

  it("skips empty lines", () => {
    const spy = vi.fn();
    adapter.on("error", spy);

    adapter.write("\n\n\n");
    expect(spy).not.toHaveBeenCalled();
  });

  // ── flush() ────────────────────────────────────────────────────────

  it("processes remaining buffer on flush()", () => {
    const messages: StreamParserEvent["assistant"][] = [];
    adapter.on("assistant", (...args) => messages.push(args));

    // Write without trailing newline
    adapter.write(JSON.stringify({
      type: "item.completed",
      item: { id: "msg-1", type: "agent_message", text: "Flushed" },
    }));

    expect(messages).toHaveLength(0);
    adapter.flush();
    expect(messages).toHaveLength(1);
  });

  it("flushes pending text parts on flush()", () => {
    const messages: StreamParserEvent["assistant"][] = [];
    adapter.on("assistant", (...args) => messages.push(args));

    adapter.write(line({
      type: "item.started",
      item: { id: "msg-1", type: "agent_message", text: "Pending" },
    }));

    expect(messages).toHaveLength(0);
    adapter.flush();
    expect(messages).toHaveLength(1);
    expect(messages[0][0].message.content).toEqual([{ type: "text", text: "Pending" }]);
  });

  it("flushes pending thinking parts on flush()", () => {
    const messages: StreamParserEvent["assistant"][] = [];
    adapter.on("assistant", (...args) => messages.push(args));

    adapter.write(line({
      type: "item.started",
      item: { id: "think-1", type: "reasoning", text: "Pending thinking" },
    }));

    adapter.flush();
    expect(messages).toHaveLength(1);
    expect(messages[0][0].message.content).toEqual([{ type: "thinking", thinking: "Pending thinking" }]);
  });

  // ── Text flushing before tool use ──────────────────────────────────

  it("flushes pending text before emitting tool_use", () => {
    const messages: StreamParserEvent["assistant"][] = [];
    adapter.on("assistant", (...args) => messages.push(args));

    // Agent message text (not completed)
    adapter.write(line({
      type: "item.started",
      item: { id: "msg-1", type: "agent_message", text: "Let me run this" },
    }));
    // Tool use
    adapter.write(line({
      type: "item.started",
      item: { id: "cmd-1", type: "command_execution", command: "pwd" },
    }));

    // Text should be flushed first, then tool_use
    expect(messages).toHaveLength(2);
    expect(messages[0][0].message.content[0]).toMatchObject({ type: "text" });
    expect(messages[1][0].message.content[0]).toMatchObject({ type: "tool_use" });
  });

  // ── Full conversation flow ─────────────────────────────────────────

  it("handles a complete conversation flow", () => {
    const assistantMsgs: StreamParserEvent["assistant"][] = [];
    const userMsgs: StreamParserEvent["user"][] = [];
    const results: StreamParserEvent["result"][] = [];
    adapter.on("assistant", (...args) => assistantMsgs.push(args));
    adapter.on("user", (...args) => userMsgs.push(args));
    adapter.on("result", (...args) => results.push(args));

    // Thread starts
    adapter.write(line({ type: "thread.started", thread_id: "thread-123" }));
    adapter.write(line({ type: "turn.started" }));

    // Reasoning
    adapter.write(line({
      type: "item.completed",
      item: { id: "r-1", type: "reasoning", text: "Thinking..." },
    }));

    // Assistant message
    adapter.write(line({
      type: "item.completed",
      item: { id: "m-1", type: "agent_message", text: "I'll help you" },
    }));

    // Command execution
    adapter.write(line({
      type: "item.completed",
      item: { id: "c-1", type: "command_execution", command: "ls", output: "file.ts", exit_code: 0 },
    }));

    // Turn completes
    adapter.write(line({
      type: "turn.completed",
      usage: { input_tokens: 200, output_tokens: 100 },
    }));

    // Should have: thinking, text, tool_use, result
    expect(assistantMsgs.length).toBeGreaterThanOrEqual(3);
    expect(userMsgs).toHaveLength(1); // tool_result
    expect(results).toHaveLength(1);
    expect(results[0][0].session_id).toBe("thread-123");
  });

  // ── Items without text ─────────────────────────────────────────────

  it("does not emit text for agent_message with no text", () => {
    const messages: StreamParserEvent["assistant"][] = [];
    adapter.on("assistant", (...args) => messages.push(args));

    adapter.write(line({
      type: "item.completed",
      item: { id: "msg-empty", type: "agent_message" },
    }));

    // No text to flush
    expect(messages).toHaveLength(0);
  });

  it("does not emit thinking for reasoning with no text", () => {
    const messages: StreamParserEvent["assistant"][] = [];
    adapter.on("assistant", (...args) => messages.push(args));

    adapter.write(line({
      type: "item.completed",
      item: { id: "think-empty", type: "reasoning" },
    }));

    expect(messages).toHaveLength(0);
  });

  // ── Command with empty command field ───────────────────────────────

  it("handles command_execution with missing command field", () => {
    const assistantMsgs: StreamParserEvent["assistant"][] = [];
    adapter.on("assistant", (...args) => assistantMsgs.push(args));

    adapter.write(line({
      type: "item.completed",
      item: { id: "cmd-no-command", type: "command_execution" },
    }));

    const toolUseBlock = assistantMsgs[0][0].message.content[0];
    expect(toolUseBlock).toMatchObject({
      type: "tool_use",
      input: JSON.stringify({ command: "" }),
    });
  });
});
