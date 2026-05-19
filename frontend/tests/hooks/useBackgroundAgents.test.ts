import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useBackgroundAgents } from "@/hooks/useBackgroundAgents";
import type { ChatMessage, ToolCall } from "@/types";

function msg(toolCalls: ToolCall[]): ChatMessage {
  return {
    id: "m-" + Math.random().toString(36).slice(2, 6),
    sessionId: "s1",
    role: "assistant",
    content: "",
    toolCalls,
    timestamp: new Date().toISOString(),
  };
}

function tc(overrides: Partial<ToolCall> & { name: string; input: string }): ToolCall {
  return { id: "tc-" + Math.random().toString(36).slice(2, 6), ...overrides };
}

describe("useBackgroundAgents", () => {
  it("returns empty state when no messages", () => {
    const { result } = renderHook(() => useBackgroundAgents([], []));
    expect(result.current.agents).toEqual([]);
    expect(result.current.runningCount).toBe(0);
  });

  it("returns empty state when no Task tools exist", () => {
    const messages = [msg([tc({ name: "Bash", input: '{"command":"ls"}', output: "ok" })])];
    const { result } = renderHook(() => useBackgroundAgents(messages, []));
    expect(result.current.agents).toEqual([]);
  });

  it("returns empty state for foreground Task tools", () => {
    const messages = [
      msg([
        tc({
          name: "Task",
          input: JSON.stringify({ subagent_type: "Explore", description: "Search", prompt: "find" }),
          output: "done",
        }),
      ]),
    ];
    const { result } = renderHook(() => useBackgroundAgents(messages, []));
    expect(result.current.agents).toEqual([]);
  });

  it("detects background Task tools from messages", () => {
    const messages = [
      msg([
        tc({
          id: "bg-1",
          name: "Task",
          input: JSON.stringify({
            subagent_type: "Explore",
            description: "Search codebase",
            run_in_background: true,
            model: "haiku",
          }),
          output: "found 5 files",
        }),
      ]),
    ];
    const { result } = renderHook(() => useBackgroundAgents(messages, []));
    expect(result.current.agents).toHaveLength(1);
    expect(result.current.agents[0]).toMatchObject({
      toolId: "bg-1",
      subagentType: "Explore",
      description: "Search codebase",
      model: "haiku",
      isRunning: false,
    });
    expect(result.current.runningCount).toBe(0);
  });

  it("does not keep persisted missing-output agents running after the stream is gone", () => {
    const messages = [
      msg([
        tc({
          id: "stale-bg",
          name: "Agent",
          input: JSON.stringify({
            subagent_type: "Agent",
            description: "Wait",
            run_in_background: true,
            tool: "spawnAgent",
          }),
        }),
      ]),
    ];

    const { result } = renderHook(() => useBackgroundAgents(messages, []));

    expect(result.current.agents).toHaveLength(1);
    expect(result.current.agents[0]).toMatchObject({ toolId: "stale-bg", isRunning: false });
    expect(result.current.runningCount).toBe(0);
  });

  it("ignores Codex collab wait operations in the background agent summary", () => {
    const active: ToolCall[] = [
      tc({
        id: "codex-wait",
        name: "Agent",
        input: JSON.stringify({
          subagent_type: "Agent",
          description: "Wait",
          run_in_background: true,
          tool: "wait",
        }),
      }),
    ];

    const { result } = renderHook(() => useBackgroundAgents([], active));

    expect(result.current.agents).toEqual([]);
    expect(result.current.runningCount).toBe(0);
  });

  it("detects running background agents from activeToolCalls", () => {
    const active: ToolCall[] = [
      tc({
        id: "bg-active",
        name: "Task",
        input: JSON.stringify({
          subagent_type: "Plan",
          description: "Designing architecture",
          run_in_background: true,
        }),
        // no output = still running
      }),
    ];
    const { result } = renderHook(() => useBackgroundAgents([], active));
    expect(result.current.agents).toHaveLength(1);
    expect(result.current.agents[0].isRunning).toBe(true);
    expect(result.current.runningCount).toBe(1);
  });

  it("counts running and completed agents correctly", () => {
    const messages = [
      msg([
        tc({
          id: "bg-done",
          name: "Task",
          input: JSON.stringify({ subagent_type: "Explore", description: "Done", run_in_background: true }),
          output: "result",
        }),
      ]),
    ];
    const active: ToolCall[] = [
      tc({
        id: "bg-running",
        name: "Task",
        input: JSON.stringify({ subagent_type: "Plan", description: "Working", run_in_background: true }),
      }),
    ];
    const { result } = renderHook(() => useBackgroundAgents(messages, active));
    expect(result.current.agents).toHaveLength(2);
    expect(result.current.runningCount).toBe(1);
  });

  it("ignores Task tools with malformed input JSON", () => {
    const messages = [
      msg([
        tc({
          name: "Task",
          input: "not valid json",
        }),
      ]),
    ];
    const { result } = renderHook(() => useBackgroundAgents(messages, []));
    expect(result.current.agents).toEqual([]);
  });

  it("ignores Task tools where run_in_background is not true", () => {
    const messages = [
      msg([
        tc({
          name: "Task",
          input: JSON.stringify({
            subagent_type: "Explore",
            description: "Not bg",
            run_in_background: false,
          }),
        }),
      ]),
    ];
    const { result } = renderHook(() => useBackgroundAgents(messages, []));
    expect(result.current.agents).toEqual([]);
  });

  it("returns same EMPTY reference for repeated empty inputs (memoization)", () => {
    const { result, rerender } = renderHook(() => useBackgroundAgents([], []));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("collects background agents from multiple messages", () => {
    const messages = [
      msg([
        tc({
          id: "bg-1",
          name: "Task",
          input: JSON.stringify({ subagent_type: "Explore", description: "A", run_in_background: true }),
          output: "done",
        }),
      ]),
      msg([
        tc({
          id: "bg-2",
          name: "Task",
          input: JSON.stringify({ subagent_type: "Plan", description: "B", run_in_background: true }),
          output: "done",
        }),
      ]),
    ];
    const { result } = renderHook(() => useBackgroundAgents(messages, []));
    expect(result.current.agents).toHaveLength(2);
    expect(result.current.agents[0].toolId).toBe("bg-1");
    expect(result.current.agents[1].toolId).toBe("bg-2");
  });

  it("mixes background agents from messages and activeToolCalls", () => {
    const messages = [
      msg([
        tc({
          id: "bg-msg",
          name: "Task",
          input: JSON.stringify({ subagent_type: "Explore", description: "From msg", run_in_background: true }),
          output: "result",
        }),
      ]),
    ];
    const active: ToolCall[] = [
      tc({
        id: "bg-active",
        name: "Task",
        input: JSON.stringify({ subagent_type: "Plan", description: "From active", run_in_background: true }),
      }),
    ];
    const { result } = renderHook(() => useBackgroundAgents(messages, active));
    expect(result.current.agents).toHaveLength(2);
    expect(result.current.agents[0].isRunning).toBe(false);
    expect(result.current.agents[1].isRunning).toBe(true);
    expect(result.current.runningCount).toBe(1);
  });

  it("skips messages without toolCalls", () => {
    const messages: ChatMessage[] = [
      {
        id: "m1",
        sessionId: "s1",
        role: "user",
        content: "Hello",
        timestamp: new Date().toISOString(),
      },
      {
        id: "m2",
        sessionId: "s1",
        role: "assistant",
        content: "Hi",
        timestamp: new Date().toISOString(),
      },
    ];
    const { result } = renderHook(() => useBackgroundAgents(messages, []));
    expect(result.current.agents).toEqual([]);
  });

  it("handles a mix of background and foreground tasks in same message", () => {
    const messages = [
      msg([
        tc({
          id: "fg",
          name: "Task",
          input: JSON.stringify({ subagent_type: "Explore", description: "FG", run_in_background: false }),
          output: "done",
        }),
        tc({
          id: "bg",
          name: "Task",
          input: JSON.stringify({ subagent_type: "Plan", description: "BG", run_in_background: true }),
          output: "done",
        }),
      ]),
    ];
    const { result } = renderHook(() => useBackgroundAgents(messages, []));
    expect(result.current.agents).toHaveLength(1);
    expect(result.current.agents[0].toolId).toBe("bg");
  });

  it("handles output as empty string (still counts as completed)", () => {
    const messages = [
      msg([
        tc({
          id: "bg-empty",
          name: "Task",
          input: JSON.stringify({ subagent_type: "Explore", description: "Empty", run_in_background: true }),
          output: "",
        }),
      ]),
    ];
    const { result } = renderHook(() => useBackgroundAgents(messages, []));
    expect(result.current.agents).toHaveLength(1);
    // empty string is not undefined, so it's completed
    expect(result.current.agents[0].isRunning).toBe(false);
    expect(result.current.runningCount).toBe(0);
  });

  it("handles many background agents", () => {
    const completedTools = Array.from({ length: 5 }, (_, i) =>
      tc({
        id: `bg-${i}`,
        name: "Task",
        input: JSON.stringify({ subagent_type: "Explore", description: `Agent ${i}`, run_in_background: true }),
        output: "done",
      }),
    );
    const activeTools = Array.from({ length: 5 }, (_, i) =>
      tc({
        id: `bg-${i + 5}`,
        name: "Task",
        input: JSON.stringify({ subagent_type: "Explore", description: `Agent ${i + 5}`, run_in_background: true }),
      }),
    );

    const { result } = renderHook(() => useBackgroundAgents([msg(completedTools)], activeTools));

    expect(result.current.agents).toHaveLength(10);
    expect(result.current.runningCount).toBe(5);
  });

  it("ignores non-Task tools in activeToolCalls", () => {
    const active: ToolCall[] = [
      tc({ name: "Bash", input: '{"command":"ls"}' }),
      tc({ name: "Read", input: '{"file_path":"/a"}' }),
    ];
    const { result } = renderHook(() => useBackgroundAgents([], active));
    expect(result.current.agents).toEqual([]);
  });

  it("model field is undefined when not provided", () => {
    const messages = [
      msg([
        tc({
          id: "no-model",
          name: "Task",
          input: JSON.stringify({ subagent_type: "Explore", description: "X", run_in_background: true }),
          output: "done",
        }),
      ]),
    ];
    const { result } = renderHook(() => useBackgroundAgents(messages, []));
    expect(result.current.agents[0].model).toBeUndefined();
  });
});
