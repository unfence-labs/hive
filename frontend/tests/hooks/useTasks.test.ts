import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTasks } from "@/hooks/useTasks";
import type { AgentActivity, ChatMessage, ToolCall } from "@/types";

function msg(toolCalls: ToolCall[], agentActivities?: AgentActivity[]): ChatMessage {
  return {
    id: "m-" + Math.random().toString(36).slice(2, 6),
    sessionId: "s1",
    role: "assistant",
    content: "",
    toolCalls,
    agentActivities,
    timestamp: new Date().toISOString(),
  };
}

function tc(overrides: Partial<ToolCall> & { name: string; input: string }): ToolCall {
  return { id: "tc-" + Math.random().toString(36).slice(2, 6), ...overrides };
}

describe("useTasks", () => {
  it("returns empty state when no messages", () => {
    const { result } = renderHook(() => useTasks([], []));
    expect(result.current.tasks).toEqual([]);
    expect(result.current.currentTask).toBeUndefined();
    expect(result.current.counts).toEqual({ total: 0, completed: 0, inProgress: 0, pending: 0 });
  });

  it("returns empty state when no task tools exist", () => {
    const messages = [msg([tc({ name: "Bash", input: '{"command":"ls"}', output: "ok" })])];
    const { result } = renderHook(() => useTasks(messages, []));
    expect(result.current.tasks).toEqual([]);
  });

  it("derives a task from TaskCreate with output", () => {
    const messages = [
      msg([
        tc({
          name: "TaskCreate",
          input: JSON.stringify({ subject: "Fix auth bug", description: "Login fails", activeForm: "Fixing auth bug" }),
          output: "Task #1 created successfully: Fix auth bug",
        }),
      ]),
    ];
    const { result } = renderHook(() => useTasks(messages, []));
    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0]).toMatchObject({
      id: "1",
      subject: "Fix auth bug",
      description: "Login fails",
      activeForm: "Fixing auth bug",
      status: "pending",
    });
  });

  it("applies TaskUpdate to change status", () => {
    const messages = [
      msg([
        tc({
          name: "TaskCreate",
          input: JSON.stringify({ subject: "Write tests" }),
          output: "Task #1 created successfully: Write tests",
        }),
        tc({
          name: "TaskUpdate",
          input: JSON.stringify({ taskId: "1", status: "in_progress", activeForm: "Writing tests" }),
          output: "Task #1 updated",
        }),
      ]),
    ];
    const { result } = renderHook(() => useTasks(messages, []));
    expect(result.current.tasks[0]).toMatchObject({
      id: "1",
      status: "in_progress",
      activeForm: "Writing tests",
    });
    expect(result.current.currentTask?.id).toBe("1");
  });

  it("handles task deletion", () => {
    const messages = [
      msg([
        tc({
          name: "TaskCreate",
          input: JSON.stringify({ subject: "Temp task" }),
          output: "Task #1 created successfully: Temp task",
        }),
        tc({
          name: "TaskUpdate",
          input: JSON.stringify({ taskId: "1", status: "deleted" }),
          output: "Task #1 deleted",
        }),
      ]),
    ];
    const { result } = renderHook(() => useTasks(messages, []));
    expect(result.current.tasks).toHaveLength(0);
  });

  it("handles in-flight TaskCreate (no output yet)", () => {
    const active: ToolCall[] = [
      tc({
        id: "tc-live",
        name: "TaskCreate",
        input: JSON.stringify({ subject: "New task", activeForm: "Creating new task" }),
      }),
    ];
    const { result } = renderHook(() => useTasks([], active));
    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0]).toMatchObject({
      id: "_pending_tc-live",
      subject: "New task",
      isCreating: true,
      status: "pending",
    });
  });

  it("tracks multiple tasks with correct counts", () => {
    const messages = [
      msg([
        tc({
          name: "TaskCreate",
          input: JSON.stringify({ subject: "Task A" }),
          output: "Task #1 created: Task A",
        }),
        tc({
          name: "TaskCreate",
          input: JSON.stringify({ subject: "Task B" }),
          output: "Task #2 created: Task B",
        }),
        tc({
          name: "TaskCreate",
          input: JSON.stringify({ subject: "Task C" }),
          output: "Task #3 created: Task C",
        }),
        tc({
          name: "TaskUpdate",
          input: JSON.stringify({ taskId: "1", status: "completed" }),
          output: "ok",
        }),
        tc({
          name: "TaskUpdate",
          input: JSON.stringify({ taskId: "2", status: "in_progress" }),
          output: "ok",
        }),
      ]),
    ];
    const { result } = renderHook(() => useTasks(messages, []));
    expect(result.current.tasks).toHaveLength(3);
    expect(result.current.counts).toEqual({ total: 3, completed: 1, inProgress: 1, pending: 1 });
    expect(result.current.currentTask?.id).toBe("2");
  });

  it("reconstructs state from history hydration", () => {
    // Simulates loading a past session with multiple messages
    const messages = [
      msg([
        tc({
          name: "TaskCreate",
          input: JSON.stringify({ subject: "Setup DB" }),
          output: "Task #1 created: Setup DB",
        }),
      ]),
      msg([
        tc({
          name: "TaskUpdate",
          input: JSON.stringify({ taskId: "1", status: "in_progress", activeForm: "Setting up DB" }),
          output: "ok",
        }),
      ]),
      msg([
        tc({
          name: "TaskUpdate",
          input: JSON.stringify({ taskId: "1", status: "completed" }),
          output: "ok",
        }),
      ]),
    ];
    const { result } = renderHook(() => useTasks(messages, []));
    expect(result.current.tasks[0]).toMatchObject({ id: "1", status: "completed" });
    expect(result.current.currentTask).toBeUndefined();
    expect(result.current.counts.completed).toBe(1);
  });

  it("parses JSON-structured TaskCreate output (task.id)", () => {
    const messages = [
      msg([
        tc({
          name: "TaskCreate",
          input: JSON.stringify({ subject: "Structured" }),
          output: JSON.stringify({ task: { id: "42", subject: "Structured" } }),
        }),
      ]),
    ];
    const { result } = renderHook(() => useTasks(messages, []));
    expect(result.current.tasks[0].id).toBe("42");
  });

  it("parses JSON-structured TaskCreate output (top-level taskId)", () => {
    const messages = [
      msg([
        tc({
          name: "TaskCreate",
          input: JSON.stringify({ subject: "Top-level" }),
          output: JSON.stringify({ taskId: "7" }),
        }),
      ]),
    ];
    const { result } = renderHook(() => useTasks(messages, []));
    expect(result.current.tasks[0].id).toBe("7");
  });

  it("parses JSON-structured TaskCreate output (top-level id)", () => {
    const messages = [
      msg([
        tc({
          name: "TaskCreate",
          input: JSON.stringify({ subject: "Plain id" }),
          output: JSON.stringify({ id: "99" }),
        }),
      ]),
    ];
    const { result } = renderHook(() => useTasks(messages, []));
    expect(result.current.tasks[0].id).toBe("99");
  });

  it("ignores TaskUpdate for unknown taskId", () => {
    const messages = [
      msg([
        tc({
          name: "TaskUpdate",
          input: JSON.stringify({ taskId: "999", status: "completed" }),
          output: "ok",
        }),
      ]),
    ];
    const { result } = renderHook(() => useTasks(messages, []));
    expect(result.current.tasks).toHaveLength(0);
  });

  it("ignores invalid status values in TaskUpdate", () => {
    const messages = [
      msg([
        tc({
          name: "TaskCreate",
          input: JSON.stringify({ subject: "Test" }),
          output: "Task #1 created: Test",
        }),
        tc({
          name: "TaskUpdate",
          input: JSON.stringify({ taskId: "1", status: "bogus_status" }),
          output: "ok",
        }),
      ]),
    ];
    const { result } = renderHook(() => useTasks(messages, []));
    expect(result.current.tasks[0].status).toBe("pending");
  });

  it("uses fallback indexed id when TaskCreate output has no task number", () => {
    const messages = [
      msg([
        tc({
          name: "TaskCreate",
          input: JSON.stringify({ subject: "No numeric id" }),
          output: "Task created successfully",
        }),
      ]),
    ];
    const { result } = renderHook(() => useTasks(messages, []));
    expect(result.current.tasks[0]).toMatchObject({
      id: "_idx_1",
      subject: "No numeric id",
    });
  });

  it("uses generated subjects when TaskCreate input is invalid JSON", () => {
    const messages = [
      msg([
        tc({ name: "TaskCreate", input: "{invalid-json", output: "Task #1 created" }),
        tc({ name: "TaskCreate", input: "{invalid-json", output: "Task #2 created" }),
      ]),
    ];
    const { result } = renderHook(() => useTasks(messages, []));
    expect(result.current.tasks).toHaveLength(2);
    expect(result.current.tasks[0].subject).toBe("Task 1");
    expect(result.current.tasks[1].subject).toBe("Task 2");
  });

  it("updates subject/description/activeForm from TaskUpdate", () => {
    const messages = [
      msg([
        tc({
          name: "TaskCreate",
          input: JSON.stringify({ subject: "Old subject", description: "Old description" }),
          output: "Task #1 created",
        }),
        tc({
          name: "TaskUpdate",
          input: JSON.stringify({
            taskId: "1",
            subject: "New subject",
            description: "New description",
            activeForm: "Working on new subject",
          }),
          output: "Task #1 updated",
        }),
      ]),
    ];
    const { result } = renderHook(() => useTasks(messages, []));
    expect(result.current.tasks[0]).toMatchObject({
      id: "1",
      subject: "New subject",
      description: "New description",
      activeForm: "Working on new subject",
    });
  });

  it("applies active task updates after persisted history", () => {
    const messages = [
      msg([
        tc({
          name: "TaskCreate",
          input: JSON.stringify({ subject: "Track me" }),
          output: "Task #1 created",
        }),
      ]),
    ];
    const active = [
      tc({
        name: "TaskUpdate",
        input: JSON.stringify({ taskId: "1", status: "in_progress" }),
        output: "Task #1 updated",
      }),
    ];
    const { result } = renderHook(() => useTasks(messages, active));
    expect(result.current.tasks[0].status).toBe("in_progress");
    expect(result.current.currentTask?.id).toBe("1");
  });

  it("derives tasks from the latest Codex plan update", () => {
    const messages = [
      msg([], [{
        id: "codex-plan-old",
        kind: "plan_update",
        steps: [{ text: "Old step", status: "completed" }],
      }]),
      msg([], [{
        id: "codex-plan-current",
        kind: "plan_update",
        steps: [
          { text: "Inspect app-server flow", status: "completed" },
          { text: "Move plan to tracker", status: "inProgress" },
          { text: "Verify mobile parity", status: "pending" },
        ],
      }]),
    ];

    const { result } = renderHook(() => useTasks(messages, []));

    expect(result.current.tasks.map((task) => task.subject)).toEqual([
      "Inspect app-server flow",
      "Move plan to tracker",
      "Verify mobile parity",
    ]);
    expect(result.current.tasks.map((task) => task.status)).toEqual(["completed", "in_progress", "pending"]);
    expect(result.current.currentTask?.subject).toBe("Move plan to tracker");
    expect(result.current.counts).toEqual({ total: 3, completed: 1, inProgress: 1, pending: 1 });
    expect(result.current.trackerSource).toBe("codex_plan");
    expect(result.current.trackerStatus).toBe("unconfirmed");
  });

  it("uses active Codex plan updates over persisted plans", () => {
    const messages = [
      msg([], [{
        id: "codex-plan-history",
        kind: "plan_update",
        steps: [{ text: "Historical plan", status: "completed" }],
      }]),
    ];
    const activeActivities: AgentActivity[] = [{
      id: "codex-plan-live",
      kind: "plan_update",
      steps: [
        { text: "Live implementation", status: "inProgress" },
        { text: "Run checks", status: "pending" },
      ],
    }];

    const { result } = renderHook(() => useTasks(messages, [], activeActivities));

    expect(result.current.tasks.map((task) => task.subject)).toEqual(["Live implementation", "Run checks"]);
    expect(result.current.currentTask?.subject).toBe("Live implementation");
    expect(result.current.trackerSource).toBe("codex_plan");
    expect(result.current.trackerStatus).toBe("live");
  });

  it("keeps completed historical Codex plan updates live", () => {
    const messages = [
      msg([], [{
        id: "codex-plan-history",
        kind: "plan_update",
        steps: [
          { text: "Inspect", status: "completed" },
          { text: "Patch", status: "completed" },
        ],
      }]),
    ];

    const { result } = renderHook(() => useTasks(messages, []));

    expect(result.current.trackerStatus).toBe("live");
    expect(result.current.counts).toEqual({ total: 2, completed: 2, inProgress: 0, pending: 0 });
  });

  it("preserves failed and declined Codex plan statuses", () => {
    const messages = [
      msg([], [{
        id: "codex-plan-failed",
        kind: "plan_update",
        steps: [
          { text: "Try risky migration", status: "failed" },
          { text: "Skip rejected change", status: "declined" },
        ],
      }]),
    ];

    const { result } = renderHook(() => useTasks(messages, []));

    expect(result.current.tasks.map((task) => task.status)).toEqual(["failed", "declined"]);
    expect(result.current.counts).toEqual({ total: 2, completed: 0, inProgress: 0, pending: 0 });
    expect(result.current.trackerStatus).toBe("live");
  });
});
