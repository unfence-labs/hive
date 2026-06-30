import { describe, expect, it } from "vitest";
import { AgentEventNormalizer } from "./agent-event-normalizer.js";
import type { CliJsonLine } from "../types.js";

function assistant(
  content: Extract<CliJsonLine, { type: "assistant" }>["message"]["content"],
  usage?: Extract<CliJsonLine, { type: "assistant" }>["message"]["usage"],
  envelope?: { parent_tool_use_id?: string | null },
): Extract<CliJsonLine, { type: "assistant" }> {
  return {
    type: "assistant",
    ...(envelope ?? {}),
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

  it("nests a subagent's tool under its parent via the native parent_tool_use_id", () => {
    const normalizer = new AgentEventNormalizer();

    // The Agent spawn is top-level (parent null); the tool it runs arrives in a
    // sidechain message stamped with the Agent's id.
    const spawn = normalizer.handleAssistant(assistant(
      [{ type: "tool_use", id: "agent-1", name: "Agent", input: { prompt: "inspect" } }],
      undefined,
      { parent_tool_use_id: null },
    ));
    const child = normalizer.handleAssistant(assistant(
      [{ type: "tool_use", id: "bash-1", name: "Bash", input: { command: "ls" } }],
      undefined,
      { parent_tool_use_id: "agent-1" },
    ));

    expect(spawn[0]).toMatchObject({ type: "tool_started", id: "agent-1", parentToolUseId: undefined });
    expect(child[0]).toMatchObject({ type: "tool_started", id: "bash-1", parentToolUseId: "agent-1" });
  });

  it("assigns parallel subagents' children to their own parents (no cross-contamination)", () => {
    const normalizer = new AgentEventNormalizer();

    // Two Agents spawn top-level, then their children interleave — the exact case
    // the old heuristic stack mis-attributed. Each child carries its true parent.
    normalizer.handleAssistant(assistant(
      [{ type: "tool_use", id: "agent-A", name: "Agent", input: {} }],
      undefined,
      { parent_tool_use_id: null },
    ));
    normalizer.handleAssistant(assistant(
      [{ type: "tool_use", id: "agent-B", name: "Agent", input: {} }],
      undefined,
      { parent_tool_use_id: null },
    ));
    const childA = normalizer.handleAssistant(assistant(
      [{ type: "tool_use", id: "bash-A", name: "Bash", input: { command: "a" } }],
      undefined,
      { parent_tool_use_id: "agent-A" },
    ));
    const childB = normalizer.handleAssistant(assistant(
      [{ type: "tool_use", id: "bash-B", name: "Bash", input: { command: "b" } }],
      undefined,
      { parent_tool_use_id: "agent-B" },
    ));

    expect(childA[0]).toMatchObject({ type: "tool_started", parentToolUseId: "agent-A" });
    expect(childB[0]).toMatchObject({ type: "tool_started", parentToolUseId: "agent-B" });
  });

  it("falls back to top-level when a message carries no native parent field", () => {
    const normalizer = new AgentEventNormalizer();

    // Shapes that omit the envelope field (e.g. non-Claude streams) degrade to a
    // flat tree rather than crashing — there is no heuristic stack to consult.
    const events = normalizer.handleAssistant(assistant([
      { type: "tool_use", id: "read-1", name: "Read", input: { file_path: "a.ts" } },
    ]));

    expect(events[0]).toMatchObject({ type: "tool_started", parentToolUseId: undefined });
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

  it("normalizes user tool_result blocks into tool completions", () => {
    const normalizer = new AgentEventNormalizer();

    const events = normalizer.handleUser(user([
      { type: "tool_result", tool_use_id: "task-1", content: "done" },
    ]));

    expect(events).toEqual([
      { type: "tool_completed", id: "task-1", output: "done" },
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
});
