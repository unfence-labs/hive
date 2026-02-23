import { describe, it, expect, beforeEach, vi } from "vitest";
import { GeminiStreamAdapter } from "./gemini-stream-adapter.js";
import type { StreamParserEvent } from "../stream-parser.js";

function line(obj: Record<string, unknown>): string {
  return JSON.stringify(obj) + "\n";
}

describe("GeminiStreamAdapter", () => {
  let adapter: GeminiStreamAdapter;

  beforeEach(() => {
    adapter = new GeminiStreamAdapter();
  });

  // ── Init event ──────────────────────────────────────────────────────

  it("captures session_id from init event", () => {
    adapter.write(line({ type: "init", session_id: "sess-abc", model: "gemini-2.5-pro" }));
    expect(adapter.capturedSessionId).toBe("sess-abc");
  });

  it("does not emit events for init", () => {
    const spy = vi.fn();
    adapter.on("assistant", spy);
    adapter.on("result", spy);
    adapter.on("error", spy);

    adapter.write(line({ type: "init", session_id: "sess-abc", model: "gemini-2.5-pro" }));
    expect(spy).not.toHaveBeenCalled();
  });

  // ── Message events ──────────────────────────────────────────────────

  it("emits assistant text from assistant message with delta", () => {
    const messages: StreamParserEvent["assistant"][] = [];
    adapter.on("assistant", (...args) => messages.push(args));

    adapter.write(line({ type: "message", role: "assistant", content: "Hello!", delta: true }));

    expect(messages).toHaveLength(1);
    const [data] = messages[0];
    expect(data.type).toBe("assistant");
    expect(data.message.content).toEqual([{ type: "text", text: "Hello!" }]);
  });

  it("emits each assistant message chunk separately for streaming", () => {
    const messages: StreamParserEvent["assistant"][] = [];
    adapter.on("assistant", (...args) => messages.push(args));

    adapter.write(line({ type: "message", role: "assistant", content: "Part 1 ", delta: true }));
    adapter.write(line({ type: "message", role: "assistant", content: "Part 2", delta: true }));

    expect(messages).toHaveLength(2);
    expect(messages[0][0].message.content[0]).toMatchObject({ type: "text", text: "Part 1 " });
    expect(messages[1][0].message.content[0]).toMatchObject({ type: "text", text: "Part 2" });
  });

  it("skips user messages", () => {
    const spy = vi.fn();
    adapter.on("assistant", spy);
    adapter.on("user", spy);

    adapter.write(line({ type: "message", role: "user", content: "user input" }));
    expect(spy).not.toHaveBeenCalled();
  });

  it("skips assistant messages with empty content", () => {
    const spy = vi.fn();
    adapter.on("assistant", spy);

    adapter.write(line({ type: "message", role: "assistant", content: "", delta: true }));
    expect(spy).not.toHaveBeenCalled();
  });

  // ── Tool use ────────────────────────────────────────────────────────

  it("emits tool_use with mapped tool name for run_shell_command", () => {
    const messages: StreamParserEvent["assistant"][] = [];
    adapter.on("assistant", (...args) => messages.push(args));

    adapter.write(line({
      type: "tool_use",
      tool_name: "run_shell_command",
      tool_id: "cmd-123",
      parameters: { command: "ls -la", description: "List files" },
    }));

    expect(messages).toHaveLength(1);
    expect(messages[0][0].message.content[0]).toMatchObject({
      type: "tool_use",
      id: "cmd-123",
      name: "Bash",
    });
  });

  it("maps read_file to Read", () => {
    const messages: StreamParserEvent["assistant"][] = [];
    adapter.on("assistant", (...args) => messages.push(args));

    adapter.write(line({
      type: "tool_use",
      tool_name: "read_file",
      tool_id: "rf-1",
      parameters: { path: "/tmp/test.txt" },
    }));

    expect(messages[0][0].message.content[0]).toMatchObject({ name: "Read" });
  });

  it("maps replace_in_file to Edit", () => {
    const messages: StreamParserEvent["assistant"][] = [];
    adapter.on("assistant", (...args) => messages.push(args));

    adapter.write(line({
      type: "tool_use",
      tool_name: "replace_in_file",
      tool_id: "edit-1",
      parameters: { path: "app.ts", old_string: "foo", new_string: "bar" },
    }));

    expect(messages[0][0].message.content[0]).toMatchObject({ name: "Edit" });
  });

  it("passes through unmapped tool names as-is", () => {
    const messages: StreamParserEvent["assistant"][] = [];
    adapter.on("assistant", (...args) => messages.push(args));

    adapter.write(line({
      type: "tool_use",
      tool_name: "some_new_tool",
      tool_id: "new-1",
      parameters: { foo: "bar" },
    }));

    expect(messages[0][0].message.content[0]).toMatchObject({ name: "some_new_tool" });
  });

  it("serializes tool parameters as JSON input", () => {
    const messages: StreamParserEvent["assistant"][] = [];
    adapter.on("assistant", (...args) => messages.push(args));

    adapter.write(line({
      type: "tool_use",
      tool_name: "run_shell_command",
      tool_id: "cmd-1",
      parameters: { command: "echo hi" },
    }));

    const input = messages[0][0].message.content[0];
    expect("input" in input && typeof input.input === "string").toBe(true);
    if ("input" in input) {
      expect(JSON.parse(input.input as string)).toEqual({ command: "echo hi" });
    }
  });

  // ── Tool result ─────────────────────────────────────────────────────

  it("emits tool_result with mapped fields", () => {
    const userMsgs: StreamParserEvent["user"][] = [];
    adapter.on("user", (...args) => userMsgs.push(args));

    adapter.write(line({
      type: "tool_result",
      tool_id: "cmd-123",
      status: "success",
      output: "file1\nfile2",
    }));

    expect(userMsgs).toHaveLength(1);
    expect(userMsgs[0][0].message.content[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "cmd-123",
      content: "file1\nfile2",
    });
  });

  // ── Result event ────────────────────────────────────────────────────

  it("emits result with mapped stats", () => {
    const results: StreamParserEvent["result"][] = [];
    adapter.on("result", (...args) => results.push(args));

    adapter.write(line({ type: "init", session_id: "sess-xyz", model: "gemini-2.5-flash" }));
    adapter.write(line({
      type: "result",
      status: "success",
      stats: { total_tokens: 1000, input_tokens: 800, output_tokens: 200, cached: 100, duration_ms: 3000, tool_calls: 1 },
    }));

    expect(results).toHaveLength(1);
    const [data] = results[0];
    expect(data.session_id).toBe("sess-xyz");
    expect(data.duration_ms).toBe(3000);
    expect(data.usage).toEqual({ input_tokens: 800, output_tokens: 200 });
  });

  it("emits result without stats when not provided", () => {
    const results: StreamParserEvent["result"][] = [];
    adapter.on("result", (...args) => results.push(args));

    adapter.write(line({ type: "result", status: "success" }));

    expect(results).toHaveLength(1);
    expect(results[0][0].usage).toBeUndefined();
  });

  // ── Error events ────────────────────────────────────────────────────

  it("emits error for error event type", () => {
    const errors: Error[] = [];
    adapter.on("error", (err) => errors.push(err));

    adapter.write(line({ type: "error", error: "API rate limit" }));

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("API rate limit");
  });

  it("uses message field as fallback for error", () => {
    const errors: Error[] = [];
    adapter.on("error", (err) => errors.push(err));

    adapter.write(line({ type: "error", message: "Fallback msg" }));

    expect(errors[0].message).toBe("Fallback msg");
  });

  it("uses generic message when error has no error or message", () => {
    const errors: Error[] = [];
    adapter.on("error", (err) => errors.push(err));

    adapter.write(line({ type: "error" }));

    expect(errors[0].message).toBe("Gemini error");
  });

  // ── Malformed JSON ──────────────────────────────────────────────────

  it("emits error for malformed JSON lines", () => {
    const errors: Error[] = [];
    adapter.on("error", (err) => errors.push(err));

    adapter.write("not json\n");

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("Malformed Gemini JSON line");
  });

  // ── Unknown event types ─────────────────────────────────────────────

  it("does not crash on unknown event types", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    adapter.write(line({ type: "some.unknown.event" }));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[gemini-adapter]"), "some.unknown.event");
    spy.mockRestore();
  });

  // ── Line buffering ──────────────────────────────────────────────────

  it("handles partial lines across multiple writes", () => {
    const messages: StreamParserEvent["assistant"][] = [];
    adapter.on("assistant", (...args) => messages.push(args));

    const fullLine = JSON.stringify({
      type: "message",
      role: "assistant",
      content: "Split across writes",
      delta: true,
    });

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

  // ── flush() ─────────────────────────────────────────────────────────

  it("processes remaining buffer on flush()", () => {
    adapter.write(JSON.stringify({ type: "init", session_id: "s1", model: "m" }));
    expect(adapter.capturedSessionId).toBeUndefined();

    adapter.flush();
    expect(adapter.capturedSessionId).toBe("s1");
  });

  // ── Full conversation flow ──────────────────────────────────────────

  it("handles a complete conversation flow", () => {
    const assistantMsgs: StreamParserEvent["assistant"][] = [];
    const userMsgs: StreamParserEvent["user"][] = [];
    const results: StreamParserEvent["result"][] = [];
    adapter.on("assistant", (...args) => assistantMsgs.push(args));
    adapter.on("user", (...args) => userMsgs.push(args));
    adapter.on("result", (...args) => results.push(args));

    // Init
    adapter.write(line({ type: "init", session_id: "sess-full", model: "gemini-2.5-pro" }));

    // User message (skipped)
    adapter.write(line({ type: "message", role: "user", content: "list files" }));

    // Assistant text
    adapter.write(line({ type: "message", role: "assistant", content: "I'll list the files.", delta: true }));

    // Tool call
    adapter.write(line({
      type: "tool_use",
      tool_name: "run_shell_command",
      tool_id: "cmd-1",
      parameters: { command: "ls /tmp" },
    }));

    // Tool result
    adapter.write(line({
      type: "tool_result",
      tool_id: "cmd-1",
      status: "success",
      output: "file1\nfile2",
    }));

    // Final assistant text
    adapter.write(line({ type: "message", role: "assistant", content: "Found 2 files.", delta: true }));

    // Result
    adapter.write(line({
      type: "result",
      status: "success",
      stats: { input_tokens: 500, output_tokens: 50, duration_ms: 2000 },
    }));

    // 2 text messages + 1 tool_use = 3 assistant events
    expect(assistantMsgs).toHaveLength(3);
    // 1 tool_result = 1 user event
    expect(userMsgs).toHaveLength(1);
    // 1 result
    expect(results).toHaveLength(1);
    expect(results[0][0].session_id).toBe("sess-full");
    expect(adapter.capturedSessionId).toBe("sess-full");
  });
});
