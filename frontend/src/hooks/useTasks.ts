import { useMemo } from "react";
import type { AgentActivity, ChatMessage, ToolCall } from "@/types";

export interface TrackedTask {
  id: string;
  subject: string;
  description?: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "declined";
  /** True while the TaskCreate tool_use hasn't received its result yet. */
  isCreating?: boolean;
}

export interface TaskCounts {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
}

export type TaskTrackerStatus = "live" | "unconfirmed";

export interface TasksState {
  tasks: TrackedTask[];
  currentTask: TrackedTask | undefined;
  counts: TaskCounts;
  trackerStatus: TaskTrackerStatus;
}

const VALID_STATUSES = new Set(["pending", "in_progress", "completed", "failed", "declined"]);
const TASK_TOOL_NAMES = new Set(["TaskCreate", "TaskUpdate", "TodoList"]);

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

function parseTodoList(tool: ToolCall): Array<{ text: string; completed: boolean }> {
  const source = tool.output ?? tool.input;
  try {
    const json = JSON.parse(source);
    const items = Array.isArray(json?.items) ? json.items : [];
    return items
      .map((item: unknown) => {
        if (!item || typeof item !== "object") return null;
        const record = item as Record<string, unknown>;
        const text = typeof record.text === "string" ? record.text : "";
        if (!text) return null;
        return { text, completed: Boolean(record.completed) };
      })
      .filter((item: { text: string; completed: boolean } | null): item is { text: string; completed: boolean } => item != null);
  } catch {
    return [];
  }
}

function normalizeTaskStatus(value: unknown): TrackedTask["status"] | undefined {
  if (value === "inProgress") return "in_progress";
  if (typeof value !== "string" || !VALID_STATUSES.has(value)) return undefined;
  return value as TrackedTask["status"];
}

function planActivityToTasks(activity: Extract<AgentActivity, { kind: "plan_update" }>): TrackedTask[] {
  return activity.steps
    .map((step, index): TrackedTask | null => {
      const subject = step.text.trim();
      if (!subject) return null;
      return {
        id: `${activity.id}-${index + 1}`,
        subject,
        status: normalizeTaskStatus(step.status) ?? "pending",
      };
    })
    .filter((task): task is TrackedTask => task != null);
}

function hasOpenPlanTask(tasks: TrackedTask[], activityId: string): boolean {
  return tasks.some(
    (task) =>
      task.id.startsWith(`${activityId}-`) &&
      (task.status === "pending" || task.status === "in_progress"),
  );
}

const EMPTY: TasksState = {
  tasks: [],
  currentTask: undefined,
  counts: { total: 0, completed: 0, inProgress: 0, pending: 0 },
  trackerStatus: "live",
};

type PlanActivityEntry = {
  activity: Extract<AgentActivity, { kind: "plan_update" }>;
  source: "history" | "active";
};

export function useTasks(
  messages: ChatMessage[],
  activeToolCalls: ToolCall[],
  activeAgentActivities: AgentActivity[] = [],
): TasksState {
  return useMemo(() => {
    // Collect all tool calls in chronological order
    const allTools: ToolCall[] = [];
    const planActivities: PlanActivityEntry[] = [];
    for (const msg of messages) {
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) allTools.push(tc);
      }
      if (msg.agentActivities) {
        for (const activity of msg.agentActivities) {
          if (activity.kind === "plan_update") planActivities.push({ activity, source: "history" });
        }
      }
    }
    for (const tc of activeToolCalls) allTools.push(tc);
    for (const activity of activeAgentActivities) {
      if (activity.kind === "plan_update") planActivities.push({ activity, source: "active" });
    }

    // Quick bail: if no task tools at all, return empty
    const hasTaskTools = allTools.some((t) => TASK_TOOL_NAMES.has(t.name));
    if (!hasTaskTools && planActivities.length === 0) return EMPTY;

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
        const status = normalizeTaskStatus(input.status);
        if (status) task.status = status;
      } else if (tool.name === "TodoList") {
        const todoItems = parseTodoList(tool);
        todoItems.forEach((item, index) => {
          const id = `codex-todo-${index + 1}`;
          tasks.set(id, {
            id,
            subject: item.text,
            status: item.completed ? "completed" : "pending",
          });
        });
      }
    }

    // Codex app-server emits plan updates as agent activities, not tool calls.
    // Treat the latest plan as the current work tracker instead of accumulating
    // stale plans from earlier turns.
    const latestPlanEntry = planActivities.at(-1);
    if (latestPlanEntry) {
      for (const task of planActivityToTasks(latestPlanEntry.activity)) {
        tasks.set(`plan:${task.id}`, task);
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
    // A persisted Codex plan with open steps is only the last reported snapshot,
    // not proof that the finished turn still has work remaining.
    const hasUnconfirmedOpenPlanTasks =
      latestPlanEntry?.source === "history" &&
      hasOpenPlanTask(taskList, latestPlanEntry.activity.id);
    const trackerStatus: TaskTrackerStatus = hasUnconfirmedOpenPlanTasks ? "unconfirmed" : "live";

    return { tasks: taskList, currentTask, counts, trackerStatus };
  }, [messages, activeToolCalls, activeAgentActivities]);
}
