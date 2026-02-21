import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TaskTracker from "@/components/TaskTracker";
import type { TrackedTask, TaskCounts } from "@/hooks/useTasks";

function task(overrides: Partial<TrackedTask> & { id: string; subject: string }): TrackedTask {
  return { status: "pending", ...overrides };
}

function counts(tasks: TrackedTask[]): TaskCounts {
  return {
    total: tasks.length,
    completed: tasks.filter((t) => t.status === "completed").length,
    inProgress: tasks.filter((t) => t.status === "in_progress").length,
    pending: tasks.filter((t) => t.status === "pending").length,
  };
}

describe("TaskTracker", () => {
  it("renders nothing when tasks array is empty", () => {
    const { container } = render(
      <TaskTracker
        tasks={[]}
        currentTask={undefined}
        counts={{ total: 0, completed: 0, inProgress: 0, pending: 0 }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows current task activeForm when collapsed", () => {
    const tasks = [
      task({ id: "1", subject: "Fix bug", activeForm: "Fixing the bug", status: "in_progress" }),
    ];
    render(
      <TaskTracker tasks={tasks} currentTask={tasks[0]} counts={counts(tasks)} />,
    );
    expect(screen.getByText("Fixing the bug")).toBeInTheDocument();
  });

  it("falls back to subject when no activeForm", () => {
    const tasks = [
      task({ id: "1", subject: "Fix bug", status: "in_progress" }),
    ];
    render(
      <TaskTracker tasks={tasks} currentTask={tasks[0]} counts={counts(tasks)} />,
    );
    expect(screen.getByText("Fix bug")).toBeInTheDocument();
  });

  it("shows 'All tasks completed' when none in progress", () => {
    const tasks = [
      task({ id: "1", subject: "Done task", status: "completed" }),
    ];
    render(
      <TaskTracker tasks={tasks} currentTask={undefined} counts={counts(tasks)} />,
    );
    expect(screen.getByText("All tasks completed")).toBeInTheDocument();
  });

  it("shows count badge", () => {
    const tasks = [
      task({ id: "1", subject: "A", status: "completed" }),
      task({ id: "2", subject: "B", status: "in_progress" }),
      task({ id: "3", subject: "C", status: "pending" }),
    ];
    render(
      <TaskTracker tasks={tasks} currentTask={tasks[1]} counts={counts(tasks)} />,
    );
    expect(screen.getByText("1/3")).toBeInTheDocument();
  });

  it("adds shimmer class when current task is streaming", () => {
    const tasks = [task({ id: "1", subject: "Fix bug", activeForm: "Fixing", status: "in_progress" })];
    render(
      <TaskTracker tasks={tasks} currentTask={tasks[0]} counts={counts(tasks)} isStreaming />,
    );

    expect(screen.getByText("Fixing")).toHaveClass("animate-shimmer");
  });

  it("expands to show all tasks on click", async () => {
    const user = userEvent.setup();
    const tasks = [
      task({ id: "1", subject: "First task", status: "completed" }),
      task({ id: "2", subject: "Second task", activeForm: "Working on second", status: "in_progress" }),
      task({ id: "3", subject: "Third task", status: "pending" }),
    ];
    render(
      <TaskTracker tasks={tasks} currentTask={tasks[1]} counts={counts(tasks)} />,
    );

    // Before expand: individual task subjects not visible
    expect(screen.queryByText("First task")).not.toBeInTheDocument();
    expect(screen.queryByText("Third task")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button"));

    // After expand: all tasks visible
    expect(screen.getByText("First task")).toBeInTheDocument();
    // "Working on second" appears in both collapsed label and expanded list
    expect(screen.getAllByText("Working on second")).toHaveLength(2);
    expect(screen.getByText("Third task")).toBeInTheDocument();
  });

  it("collapses expanded list on second click", async () => {
    const user = userEvent.setup();
    const tasks = [
      task({ id: "1", subject: "First task", status: "completed" }),
      task({ id: "2", subject: "Second task", status: "pending" }),
    ];
    render(
      <TaskTracker tasks={tasks} currentTask={undefined} counts={counts(tasks)} />,
    );

    const toggle = screen.getByRole("button");
    await user.click(toggle);
    expect(screen.getByText("First task")).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.queryByText("First task")).not.toBeInTheDocument();
  });
});
