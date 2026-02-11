import { describe, it, expect, vi } from "vitest";
import { StreamParser } from "./stream-parser.js";
import type { StreamEvent } from "../types.js";

function makeStreamEventLine(event: StreamEvent): string {
  return JSON.stringify({ type: "stream_event", event });
}

function makeResultLine(
  type = "success",
  sessionId = "sess-123",
  costUsd = 0.01
): string {
  return JSON.stringify({
    type: "result",
    result: { type },
    session_id: sessionId,
    cost_usd: costUsd,
  });
}

describe("StreamParser", () => {
  it("parses a single complete JSON line", () => {
    const parser = new StreamParser();
    const events: StreamEvent[] = [];
    parser.on("event", (e) => events.push(e));

    const line = makeStreamEventLine({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hello" },
    });
    parser.write(line + "\n");

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("content_block_delta");
  });

  it("parses multiple lines in one chunk", () => {
    const parser = new StreamParser();
    const events: StreamEvent[] = [];
    parser.on("event", (e) => events.push(e));

    const line1 = makeStreamEventLine({
      type: "message_start",
      message: { id: "msg-1", role: "assistant" },
    });
    const line2 = makeStreamEventLine({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hi" },
    });
    const line3 = makeStreamEventLine({ type: "message_stop" });

    parser.write(line1 + "\n" + line2 + "\n" + line3 + "\n");

    expect(events).toHaveLength(3);
    expect(events[0].type).toBe("message_start");
    expect(events[1].type).toBe("content_block_delta");
    expect(events[2].type).toBe("message_stop");
  });

  it("handles split lines across chunks (partial buffering)", () => {
    const parser = new StreamParser();
    const events: StreamEvent[] = [];
    parser.on("event", (e) => events.push(e));

    const full = makeStreamEventLine({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "world" },
    });

    // Split the line in the middle
    const mid = Math.floor(full.length / 2);
    parser.write(full.slice(0, mid));
    expect(events).toHaveLength(0); // Not yet complete

    parser.write(full.slice(mid) + "\n");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("content_block_delta");
  });

  it("handles malformed JSON lines gracefully", () => {
    const parser = new StreamParser();
    const events: StreamEvent[] = [];
    const errors: Error[] = [];
    parser.on("event", (e) => events.push(e));
    parser.on("error", (e) => errors.push(e));

    const validLine = makeStreamEventLine({
      type: "message_stop",
    });

    parser.write("not valid json\n" + validLine + "\n");

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("Malformed JSON line");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message_stop");
  });

  it("parses text_delta events correctly", () => {
    const parser = new StreamParser();
    const events: StreamEvent[] = [];
    parser.on("event", (e) => events.push(e));

    const line = makeStreamEventLine({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hello, world!" },
    });
    parser.write(line + "\n");

    expect(events).toHaveLength(1);
    const evt = events[0];
    expect(evt.type).toBe("content_block_delta");
    if (evt.type === "content_block_delta") {
      expect(evt.delta.type).toBe("text_delta");
      if (evt.delta.type === "text_delta") {
        expect(evt.delta.text).toBe("Hello, world!");
      }
    }
  });

  it("parses tool_use content_block_start events", () => {
    const parser = new StreamParser();
    const events: StreamEvent[] = [];
    parser.on("event", (e) => events.push(e));

    const line = makeStreamEventLine({
      type: "content_block_start",
      index: 1,
      content_block: { type: "tool_use", id: "toolu_abc123", name: "Read" },
    });
    parser.write(line + "\n");

    expect(events).toHaveLength(1);
    const evt = events[0];
    expect(evt.type).toBe("content_block_start");
    if (evt.type === "content_block_start") {
      expect(evt.content_block.type).toBe("tool_use");
      if (evt.content_block.type === "tool_use") {
        expect(evt.content_block.id).toBe("toolu_abc123");
        expect(evt.content_block.name).toBe("Read");
      }
    }
  });

  it("parses result/completion events", () => {
    const parser = new StreamParser();
    const results: Array<{ type: string; sessionId: string; costUsd?: number }> = [];
    parser.on("result", (r) => results.push(r));

    const line = makeResultLine("success", "sess-abc", 0.05);
    parser.write(line + "\n");

    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("success");
    expect(results[0].sessionId).toBe("sess-abc");
    expect(results[0].costUsd).toBe(0.05);
  });

  it("handles empty lines", () => {
    const parser = new StreamParser();
    const events: StreamEvent[] = [];
    const errors: Error[] = [];
    parser.on("event", (e) => events.push(e));
    parser.on("error", (e) => errors.push(e));

    const validLine = makeStreamEventLine({ type: "message_stop" });
    parser.write("\n\n" + validLine + "\n\n");

    expect(events).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });

  it("flushes remaining buffered data", () => {
    const parser = new StreamParser();
    const events: StreamEvent[] = [];
    parser.on("event", (e) => events.push(e));

    const line = makeStreamEventLine({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "buffered" },
    });

    // Write without trailing newline
    parser.write(line);
    expect(events).toHaveLength(0);

    parser.flush();
    expect(events).toHaveLength(1);
  });

  it("ignores assistant_message lines", () => {
    const parser = new StreamParser();
    const events: StreamEvent[] = [];
    const results: unknown[] = [];
    parser.on("event", (e) => events.push(e));
    parser.on("result", (r) => results.push(r));

    const line = JSON.stringify({
      type: "assistant_message",
      message: { role: "assistant", content: "hello" },
    });
    parser.write(line + "\n");

    expect(events).toHaveLength(0);
    expect(results).toHaveLength(0);
  });

  it("parses input_json_delta events for tool inputs", () => {
    const parser = new StreamParser();
    const events: StreamEvent[] = [];
    parser.on("event", (e) => events.push(e));

    const line = makeStreamEventLine({
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: '{"file":' },
    });
    parser.write(line + "\n");

    expect(events).toHaveLength(1);
    const evt = events[0];
    if (evt.type === "content_block_delta") {
      expect(evt.delta.type).toBe("input_json_delta");
      if (evt.delta.type === "input_json_delta") {
        expect(evt.delta.partial_json).toBe('{"file":');
      }
    }
  });

  it("handles multiple chunks building up multiple lines", () => {
    const parser = new StreamParser();
    const events: StreamEvent[] = [];
    parser.on("event", (e) => events.push(e));

    const line1 = makeStreamEventLine({
      type: "message_start",
      message: { id: "msg-1", role: "assistant" },
    });
    const line2 = makeStreamEventLine({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hi" },
    });

    // First chunk: complete line1 + partial line2
    const partial = line2.slice(0, 10);
    parser.write(line1 + "\n" + partial);
    expect(events).toHaveLength(1);

    // Second chunk: rest of line2
    parser.write(line2.slice(10) + "\n");
    expect(events).toHaveLength(2);
  });
});
