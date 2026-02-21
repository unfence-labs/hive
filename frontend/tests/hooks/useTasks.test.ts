import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTasks } from "@/hooks/useTasks";
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

  it("parses JSON-structured TaskCreate output", () => {
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
});
