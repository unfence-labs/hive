import { useMemo } from "react";
import type { ChatMessage, ToolCall } from "@/types";

export interface TrackedTask {
  id: string;
  subject: string;
  description?: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed";
  /** True while the TaskCreate tool_use hasn't received its result yet. */
  isCreating?: boolean;
}

export interface TaskCounts {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
}

export interface TasksState {
  tasks: TrackedTask[];
  currentTask: TrackedTask | undefined;
  counts: TaskCounts;
}

const VALID_STATUSES = new Set(["pending", "in_progress", "completed"]);

/**
 * Try to extract the numeric task ID from a TaskCreate result string.
 * Expected formats: "Task #1 created successfully: ..." or "Task 1 created: ..."
 */
function parseTaskId(output: string): string | null {
  // Try JSON first (various shapes depending on CLI version)
  try {
    const json = JSON.parse(output);
    const id = json?.task?.id ?? json?.taskId ?? json?.id;
    if (id != null) return String(id);
  } catch {
    // not JSON, try text
  }
  const match = output.match(/Task\s+#?(\d+)/i);
  return match ? match[1] : null;
}

function parseInput(tool: ToolCall): Record<string, unknown> {
  try {
    return JSON.parse(tool.input);
  } catch {
    return {};
  }
}

const EMPTY: TasksState = {
  tasks: [],
  currentTask: undefined,
  counts: { total: 0, completed: 0, inProgress: 0, pending: 0 },
};

export function useTasks(
  messages: ChatMessage[],
  activeToolCalls: ToolCall[],
): TasksState {
  return useMemo(() => {
    // Collect all tool calls in chronological order
    const allTools: ToolCall[] = [];
    for (const msg of messages) {
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) allTools.push(tc);
      }
    }
    for (const tc of activeToolCalls) allTools.push(tc);

    // Quick bail: if no task tools at all, return empty
    const hasTaskTools = allTools.some(
      (t) => t.name === "TaskCreate" || t.name === "TaskUpdate",
    );
    if (!hasTaskTools) return EMPTY;

    const tasks = new Map<string, TrackedTask>();
    // Track TaskCreate order for fallback ID assignment
    let createIndex = 0;

    for (const tool of allTools) {
      if (tool.name === "TaskCreate") {
        createIndex++;
        const input = parseInput(tool);
        const subject = (input.subject as string) ?? `Task ${createIndex}`;
        const description = input.description as string | undefined;
        const activeForm = input.activeForm as string | undefined;

        let id: string;
        let isCreating = false;

        if (tool.output) {
          const parsed = parseTaskId(tool.output);
          id = parsed ?? `_idx_${createIndex}`;
        } else {
          // Still streaming — use tool_use id as temp key
          id = `_pending_${tool.id}`;
          isCreating = true;
        }

        tasks.set(id, {
          id,
          subject,
          description,
          activeForm,
          status: "pending",
          ...(isCreating && { isCreating }),
        });
      } else if (tool.name === "TaskUpdate") {
        const input = parseInput(tool);
        const taskId = input.taskId as string | undefined;
        if (!taskId) continue;

        const task = tasks.get(taskId);
        if (!task) continue;

        if (input.status === "deleted") {
          tasks.delete(taskId);
          continue;
        }

        if (typeof input.subject === "string") task.subject = input.subject;
        if (typeof input.description === "string") task.description = input.description;
        if (typeof input.activeForm === "string") task.activeForm = input.activeForm;
        if (typeof input.status === "string" && VALID_STATUSES.has(input.status)) {
          task.status = input.status as TrackedTask["status"];
        }
      }
    }

    const taskList = Array.from(tasks.values());
    const currentTask = taskList.find((t) => t.status === "in_progress");
    const counts: TaskCounts = {
      total: taskList.length,
      completed: taskList.filter((t) => t.status === "completed").length,
      inProgress: taskList.filter((t) => t.status === "in_progress").length,
      pending: taskList.filter((t) => t.status === "pending").length,
    };

    return { tasks: taskList, currentTask, counts };
  }, [messages, activeToolCalls]);
}
