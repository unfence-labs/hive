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
});
