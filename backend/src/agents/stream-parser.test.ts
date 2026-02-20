import { describe, it, expect } from "vitest";
import { StreamParser } from "./stream-parser.js";
import type { CliJsonLine } from "../types.js";

function makeAssistantLine(text: string, toolUse?: { id: string; name: string; input: unknown }): string {
  const content: unknown[] = [{ type: "text", text }];
  if (toolUse) {
    content.push({ type: "tool_use", id: toolUse.id, name: toolUse.name, input: toolUse.input });
  }
  return JSON.stringify({
    type: "assistant",
    message: { id: "msg-1", role: "assistant", content },
  });
}

function makeUserLine(toolResults: Array<{ tool_use_id: string; content: string }>): string {
  return JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: toolResults.map((r) => ({ type: "tool_result", ...r })),
    },
  });
}

function makeResultLine(sessionId = "sess-123", costUsd = 0.01): string {
  return JSON.stringify({
    type: "result",
    session_id: sessionId,
    cost_usd: costUsd,
    duration_ms: 1234,
    usage: { input_tokens: 100, output_tokens: 50 },
  });
}

function makeSystemLine(message = "Compacting conversation..."): string {
  return JSON.stringify({ type: "system", message, level: "info" });
}

describe("StreamParser", () => {
  it("parses an assistant message", () => {
    const parser = new StreamParser();
    const events: Extract<CliJsonLine, { type: "assistant" }>[] = [];
    parser.on("assistant", (e) => events.push(e));

    parser.write(makeAssistantLine("Hello!") + "\n");

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("assistant");
    expect(events[0].message.content[0]).toEqual({ type: "text", text: "Hello!" });
  });

  it("parses assistant message with tool_use", () => {
    const parser = new StreamParser();
    const events: Extract<CliJsonLine, { type: "assistant" }>[] = [];
    parser.on("assistant", (e) => events.push(e));

    parser.write(
      makeAssistantLine("Let me read that file.", {
        id: "toolu_abc",
        name: "Read",
        input: { file_path: "/foo/bar.ts" },
      }) + "\n",
    );

    expect(events).toHaveLength(1);
    expect(events[0].message.content).toHaveLength(2);
    expect(events[0].message.content[1]).toEqual({
      type: "tool_use",
      id: "toolu_abc",
      name: "Read",
      input: { file_path: "/foo/bar.ts" },
    });
  });

  it("parses a user message (tool results)", () => {
    const parser = new StreamParser();
    const events: Extract<CliJsonLine, { type: "user" }>[] = [];
    parser.on("user", (e) => events.push(e));

    parser.write(
      makeUserLine([{ tool_use_id: "toolu_abc", content: "file contents here" }]) + "\n",
    );

    expect(events).toHaveLength(1);
    expect(events[0].message.content[0]).toEqual({
      type: "tool_result",
      tool_use_id: "toolu_abc",
      content: "file contents here",
    });
  });

  it("parses a result message", () => {
    const parser = new StreamParser();
    const results: Extract<CliJsonLine, { type: "result" }>[] = [];
    parser.on("result", (r) => results.push(r));

    parser.write(makeResultLine("sess-abc", 0.05) + "\n");

    expect(results).toHaveLength(1);
    expect(results[0].session_id).toBe("sess-abc");
    expect(results[0].cost_usd).toBe(0.05);
    expect(results[0].duration_ms).toBe(1234);
    expect(results[0].usage).toEqual({ input_tokens: 100, output_tokens: 50 });
  });

  it("parses a system message", () => {
    const parser = new StreamParser();
    const events: Extract<CliJsonLine, { type: "system" }>[] = [];
    parser.on("system", (e) => events.push(e));

    parser.write(makeSystemLine("Context compacted") + "\n");

    expect(events).toHaveLength(1);
    expect(events[0].message).toBe("Context compacted");
  });

  it("parses multiple lines in one chunk", () => {
    const parser = new StreamParser();
    const assistants: unknown[] = [];
    const results: unknown[] = [];
    parser.on("assistant", (e) => assistants.push(e));
    parser.on("result", (r) => results.push(r));

    const chunk =
      makeAssistantLine("Hello") +
      "\n" +
      makeAssistantLine("World") +
      "\n" +
      makeResultLine() +
      "\n";
    parser.write(chunk);

    expect(assistants).toHaveLength(2);
    expect(results).toHaveLength(1);
  });

  it("handles split lines across chunks (partial buffering)", () => {
    const parser = new StreamParser();
    const events: unknown[] = [];
    parser.on("assistant", (e) => events.push(e));

    const full = makeAssistantLine("buffered text");
    const mid = Math.floor(full.length / 2);

    parser.write(full.slice(0, mid));
    expect(events).toHaveLength(0);

    parser.write(full.slice(mid) + "\n");
    expect(events).toHaveLength(1);
  });

  it("handles malformed JSON lines gracefully", () => {
    const parser = new StreamParser();
    const events: unknown[] = [];
    const errors: Error[] = [];
    parser.on("assistant", (e) => events.push(e));
    parser.on("error", (e) => errors.push(e));

    parser.write("not valid json\n" + makeAssistantLine("valid") + "\n");

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("Malformed JSON line");
    expect(events).toHaveLength(1);
  });

  it("handles empty lines", () => {
    const parser = new StreamParser();
    const events: unknown[] = [];
    const errors: Error[] = [];
    parser.on("assistant", (e) => events.push(e));
    parser.on("error", (e) => errors.push(e));

    parser.write("\n\n" + makeAssistantLine("after blanks") + "\n\n");

    expect(events).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });

  it("flushes remaining buffered data", () => {
    const parser = new StreamParser();
    const events: unknown[] = [];
    parser.on("assistant", (e) => events.push(e));

    // Write without trailing newline
    parser.write(makeAssistantLine("buffered"));
    expect(events).toHaveLength(0);

    parser.flush();
    expect(events).toHaveLength(1);
  });

  it("emits error for unknown message types", () => {
    const parser = new StreamParser();
    const errors: Error[] = [];
    parser.on("error", (e) => errors.push(e));

    parser.write(JSON.stringify({ type: "unknown_thing", data: {} }) + "\n");

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("Unknown message type");
  });

  it("silently ignores rate_limit_event from Claude CLI", () => {
    const parser = new StreamParser();
    const errors: Error[] = [];
    parser.on("error", (e) => errors.push(e));

    parser.write(JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: {
        status: "allowed",
        resetsAt: 1771642800,
        rateLimitType: "five_hour",
        overageStatus: "rejected",
        overageDisabledReason: "org_level_disabled_until",
        isUsingOverage: false,
      },
      uuid: "5ceca816-9afd-4d1a-a57f-7bc7e117ca0e",
      session_id: "test-session",
    }) + "\n");

    expect(errors).toHaveLength(0);
  });

  it("handles multiple chunks building up multiple lines", () => {
    const parser = new StreamParser();
    const events: unknown[] = [];
    parser.on("assistant", (e) => events.push(e));

    const line1 = makeAssistantLine("First");
    const line2 = makeAssistantLine("Second");

    // First chunk: complete line1 + partial line2
    const partial = line2.slice(0, 10);
    parser.write(line1 + "\n" + partial);
    expect(events).toHaveLength(1);

    // Second chunk: rest of line2
    parser.write(line2.slice(10) + "\n");
    expect(events).toHaveLength(2);
  });

  it("parses assistant message with thinking block", () => {
    const parser = new StreamParser();
    const events: Extract<CliJsonLine, { type: "assistant" }>[] = [];
    parser.on("assistant", (e) => events.push(e));

    const line = JSON.stringify({
      type: "assistant",
      message: {
        id: "msg-1",
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Let me think about this..." },
          { type: "text", text: "Here's my answer." },
        ],
      },
    });
    parser.write(line + "\n");

    expect(events).toHaveLength(1);
    expect(events[0].message.content).toHaveLength(2);
    expect(events[0].message.content[0]).toEqual({
      type: "thinking",
      thinking: "Let me think about this...",
    });
  });

  it("parses user message with multiple tool results", () => {
    const parser = new StreamParser();
    const events: Extract<CliJsonLine, { type: "user" }>[] = [];
    parser.on("user", (e) => events.push(e));

    parser.write(
      makeUserLine([
        { tool_use_id: "toolu_1", content: "result 1" },
        { tool_use_id: "toolu_2", content: "result 2" },
      ]) + "\n",
    );

    expect(events).toHaveLength(1);
    expect(events[0].message.content).toHaveLength(2);
  });
});
