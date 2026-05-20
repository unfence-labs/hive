import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useGoalState } from "@/hooks/useGoalState";
import type { AgentActivity, ChatMessage } from "@/types";

function message(agentActivities: AgentActivity[]): ChatMessage {
  return {
    id: "m1",
    sessionId: "s1",
    role: "assistant",
    content: "",
    agentActivities,
    timestamp: "2026-05-20T00:00:00.000Z",
  };
}

function goal(overrides: Partial<Extract<AgentActivity, { kind: "goal_update" }>> = {}): Extract<AgentActivity, { kind: "goal_update" }> {
  return {
    id: "goal-1",
    kind: "goal_update",
    active: true,
    threadId: "thread-1",
    objective: "Ship Codex Goals UI",
    status: "active",
    ...overrides,
  };
}

describe("useGoalState", () => {
  it("returns null when no goal updates exist", () => {
    const { result } = renderHook(() => useGoalState([], []));
    expect(result.current).toBeNull();
  });

  it("returns the latest active goal from persisted messages", () => {
    const { result } = renderHook(() => useGoalState([
      message([goal({ id: "old", objective: "Old goal" })]),
      message([goal({ id: "new", objective: "Current goal", tokensUsed: 1_200, tokenBudget: 10_000 })]),
    ]));

    expect(result.current?.objective).toBe("Current goal");
    expect(result.current?.tokensUsed).toBe(1_200);
    expect(result.current?.tokenBudget).toBe(10_000);
  });

  it("clears the goal when the latest update is inactive", () => {
    const { result } = renderHook(() => useGoalState([
      message([goal({ active: true })]),
      message([goal({ active: false })]),
    ]));

    expect(result.current).toBeNull();
  });

  it("lets active streaming updates override persisted history", () => {
    const { result } = renderHook(() => useGoalState(
      [message([goal({ objective: "Persisted goal" })])],
      [goal({ objective: "Live goal", status: "blocked" })],
    ));

    expect(result.current?.objective).toBe("Live goal");
    expect(result.current?.status).toBe("blocked");
  });

  it("preserves null token budgets", () => {
    const { result } = renderHook(() => useGoalState([
      message([goal({ tokenBudget: null, tokensUsed: 500 })]),
    ]));

    expect(result.current?.tokenBudget).toBeNull();
  });
});
