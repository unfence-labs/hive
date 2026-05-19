import { describe, expect, it } from "vitest";
import type { ToolCall } from "@/types";
import { getSubAgentExecutionState } from "@/lib/sub-agent-status";

function tool(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: "agent-1",
    name: "Agent",
    input: JSON.stringify({
      subagent_type: "Agent",
      run_in_background: true,
      tool: "spawnAgent",
      status: "inProgress",
    }),
    ...overrides,
  };
}

function codexOutput(payload: unknown): string {
  return JSON.stringify([{ type: "text", text: JSON.stringify(payload) }]);
}

describe("sub-agent execution status", () => {
  it("keeps a completed Codex spawn tool running while its receiver agent is running", () => {
    const state = getSubAgentExecutionState(
      tool({
        output: codexOutput({
          tool: "spawnAgent",
          status: "completed",
          agentsStates: {
            "thread-child": { status: "running", message: null },
          },
        }),
      }),
      { showExecutingState: true },
    );

    expect(state).toBe("running");
  });

  it("does not keep stale persisted Codex spawn tools running outside an active stream", () => {
    const state = getSubAgentExecutionState(
      tool({
        output: codexOutput({
          tool: "spawnAgent",
          status: "completed",
          agentsStates: {
            "thread-child": { status: "running", message: null },
          },
        }),
      }),
      { showExecutingState: false },
    );

    expect(state).toBe("completed");
  });

  it("marks Codex sub-agents failed when the receiver agent failed", () => {
    const state = getSubAgentExecutionState(
      tool({
        output: codexOutput({
          tool: "spawnAgent",
          status: "completed",
          agentsStates: {
            "thread-child": { status: "errored", message: "boom" },
          },
        }),
      }),
      { showExecutingState: true },
    );

    expect(state).toBe("failed");
  });

  it("keeps a completed parent running while a descendant tool is active", () => {
    const child = tool({
      id: "child-read",
      name: "Read",
      input: "{}",
      parentToolUseId: "agent-1",
      output: undefined,
    });

    const state = getSubAgentExecutionState(
      tool({ output: "spawned" }),
      { showExecutingState: true, children: [child] },
    );

    expect(state).toBe("running");
  });
});
