import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TaskTracker from "@/components/TaskTracker";
import type { TrackedTask, TaskCounts } from "@/hooks/useTasks";
import type { BackgroundAgent } from "@/hooks/useBackgroundAgents";
import type { GoalState } from "@/hooks/useGoalState";

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

function agent(overrides: Partial<BackgroundAgent> & { toolId: string; subagentType: string }): BackgroundAgent {
  return { description: "", isRunning: true, ...overrides };
}

function goal(overrides: Partial<GoalState> = {}): GoalState {
  return {
    id: "goal-1",
    kind: "goal_update",
    active: true,
    threadId: "thread-1",
    objective: "Ship the Codex Goals UI",
    status: "active",
    ...overrides,
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

  it("renders goal section without tasks or background agents", () => {
    render(
      <TaskTracker
        goal={goal({ tokensUsed: 1_200, tokenBudget: 10_000, timeUsedSeconds: 125 })}
        tasks={[]}
        currentTask={undefined}
        counts={{ total: 0, completed: 0, inProgress: 0, pending: 0 }}
      />,
    );

    // Collapsed header shows the normalized status; the objective lives in the
    // title attribute (and the expanded view), not the collapsed label.
    expect(screen.getByText("Goal active")).toBeInTheDocument();
    expect(screen.getByTitle("Ship the Codex Goals UI")).toBeInTheDocument();
    expect(screen.getByText("1.2k/10k · 2m 5s")).toBeInTheDocument();
  });

  it("rolls compact token counts over to millions", () => {
    render(
      <TaskTracker
        goal={goal({ tokensUsed: 999_500, tokenBudget: 2_000_000 })}
        tasks={[]}
        currentTask={undefined}
        counts={{ total: 0, completed: 0, inProgress: 0, pending: 0 }}
      />,
    );

    expect(screen.getByText("1m/2m")).toBeInTheDocument();
  });

  it("expands goal details", async () => {
    const user = userEvent.setup();
    render(
      <TaskTracker
        goal={goal({ objective: "Investigate a narrow app-server regression", status: "blocked" })}
        tasks={[]}
        currentTask={undefined}
        counts={{ total: 0, completed: 0, inProgress: 0, pending: 0 }}
      />,
    );

    expect(screen.queryByText("Investigate a narrow app-server regression")).not.toBeInTheDocument();

    await user.click(screen.getByText("Goal blocked"));

    expect(screen.getByText("Investigate a narrow app-server regression")).toBeInTheDocument();
  });

  it.each([
    ["usageLimited", "Goal usage limited"],
    ["budgetLimited", "Goal budget limited"],
  ])("formats camelCase goal status %s", (status, header) => {
    render(
      <TaskTracker
        goal={goal({ status })}
        tasks={[]}
        currentTask={undefined}
        counts={{ total: 0, completed: 0, inProgress: 0, pending: 0 }}
      />,
    );

    expect(screen.getByText(header)).toBeInTheDocument();
  });

  it("orders sections as goal, tasks, then background agents", () => {
    const tasks = [task({ id: "1", subject: "Implement tracker", status: "in_progress" })];
    const agents = [
      agent({ toolId: "a1", subagentType: "Explore", description: "Search", isRunning: true }),
    ];
    const { container } = render(
      <TaskTracker
        goal={goal({ objective: "Goal first" })}
        tasks={tasks}
        currentTask={tasks[0]}
        counts={counts(tasks)}
        backgroundAgents={agents}
        backgroundRunningCount={1}
      />,
    );

    const text = container.textContent ?? "";
    expect(text.indexOf("Goal first")).toBeLessThan(text.indexOf("Implement tracker"));
    expect(text.indexOf("Implement tracker")).toBeLessThan(text.indexOf("1 background agent running"));
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

  it("shows 'All tasks completed' when all tasks are completed", () => {
    const tasks = [
      task({ id: "1", subject: "Done task", status: "completed" }),
    ];
    render(
      <TaskTracker tasks={tasks} currentTask={undefined} counts={counts(tasks)} />,
    );
    expect(screen.getByText("All tasks completed")).toBeInTheDocument();
  });

  it("shows remaining count when tasks are pending but none in progress", () => {
    const tasks = [
      task({ id: "1", subject: "A", status: "completed" }),
      task({ id: "2", subject: "B", status: "pending" }),
      task({ id: "3", subject: "C", status: "pending" }),
    ];
    render(
      <TaskTracker tasks={tasks} currentTask={undefined} counts={counts(tasks)} />,
    );
    expect(screen.getByText("2 tasks remaining")).toBeInTheDocument();
  });

  it("shows singular form for one remaining task", () => {
    const tasks = [
      task({ id: "1", subject: "A", status: "completed" }),
      task({ id: "2", subject: "B", status: "pending" }),
    ];
    render(
      <TaskTracker tasks={tasks} currentTask={undefined} counts={counts(tasks)} />,
    );
    expect(screen.getByText("1 task remaining")).toBeInTheDocument();
  });

  it("shows unconfirmed label for stale Codex plan tasks", () => {
    const tasks = [
      task({ id: "1", subject: "A", status: "completed" }),
      task({ id: "2", subject: "B", status: "in_progress" }),
      task({ id: "3", subject: "C", status: "pending" }),
    ];
    render(
      <TaskTracker
        tasks={tasks}
        currentTask={tasks[1]}
        counts={counts(tasks)}
        trackerStatus="unconfirmed"
        isStreaming
      />,
    );

    const label = screen.getByText("2 tasks unconfirmed");
    expect(label).toBeInTheDocument();
    expect(label).not.toHaveClass("animate-shimmer");
    expect(label).toHaveAttribute("title", "Codex finished before reporting a final plan update");
  });

  it("shows singular unconfirmed label", () => {
    const tasks = [
      task({ id: "1", subject: "A", status: "completed" }),
      task({ id: "2", subject: "B", status: "pending" }),
    ];
    render(
      <TaskTracker
        tasks={tasks}
        currentTask={undefined}
        counts={counts(tasks)}
        trackerStatus="unconfirmed"
      />,
    );

    expect(screen.getByText("1 task unconfirmed")).toBeInTheDocument();
  });

  it("labels failed or declined tasks as not completed", () => {
    const tasks = [
      task({ id: "1", subject: "Rejected plan step", status: "declined" }),
      task({ id: "2", subject: "Failed plan step", status: "failed" }),
    ];
    render(
      <TaskTracker tasks={tasks} currentTask={undefined} counts={counts(tasks)} />,
    );

    expect(screen.getByText("2 tasks not completed")).toBeInTheDocument();
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

    await user.click(screen.getByText("Working on second"));

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

    const toggle = screen.getByText("1 task remaining");
    await user.click(toggle);
    expect(screen.getByText("First task")).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.queryByText("First task")).not.toBeInTheDocument();
  });

  // ── Background agents ───────────────────────────────────────────────

  it("renders nothing when both tasks and background agents are empty", () => {
    const { container } = render(
      <TaskTracker
        tasks={[]}
        currentTask={undefined}
        counts={{ total: 0, completed: 0, inProgress: 0, pending: 0 }}
        backgroundAgents={[]}
        backgroundRunningCount={0}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders background agents section when agents exist without tasks", () => {
    const agents = [
      agent({ toolId: "a1", subagentType: "Explore", description: "Searching codebase", isRunning: true }),
    ];
    render(
      <TaskTracker
        tasks={[]}
        currentTask={undefined}
        counts={{ total: 0, completed: 0, inProgress: 0, pending: 0 }}
        backgroundAgents={agents}
        backgroundRunningCount={1}
      />,
    );

    expect(screen.getByText("1 background agent running")).toBeInTheDocument();
  });

  it("shows plural form for multiple running background agents", () => {
    const agents = [
      agent({ toolId: "a1", subagentType: "Explore", description: "Search", isRunning: true }),
      agent({ toolId: "a2", subagentType: "Plan", description: "Design", isRunning: true }),
    ];
    render(
      <TaskTracker
        tasks={[]}
        currentTask={undefined}
        counts={{ total: 0, completed: 0, inProgress: 0, pending: 0 }}
        backgroundAgents={agents}
        backgroundRunningCount={2}
      />,
    );

    expect(screen.getByText("2 background agents running")).toBeInTheDocument();
  });

  it("shows 'All background agents completed' when none are running", () => {
    const agents = [
      agent({ toolId: "a1", subagentType: "Explore", description: "Done", isRunning: false }),
    ];
    render(
      <TaskTracker
        tasks={[]}
        currentTask={undefined}
        counts={{ total: 0, completed: 0, inProgress: 0, pending: 0 }}
        backgroundAgents={agents}
        backgroundRunningCount={0}
      />,
    );

    expect(screen.getByText("All background agents completed")).toBeInTheDocument();
  });

  it("expands background agents to show details", async () => {
    const user = userEvent.setup();
    const agents = [
      agent({ toolId: "a1", subagentType: "Explore", description: "Searching codebase", isRunning: true }),
      agent({ toolId: "a2", subagentType: "Plan", description: "Architecture review", isRunning: false }),
    ];
    render(
      <TaskTracker
        tasks={[]}
        currentTask={undefined}
        counts={{ total: 0, completed: 0, inProgress: 0, pending: 0 }}
        backgroundAgents={agents}
        backgroundRunningCount={1}
      />,
    );

    // Before expand: details not visible
    expect(screen.queryByText("Searching codebase")).not.toBeInTheDocument();

    await user.click(screen.getByText("1 background agent running"));

    // After expand: agent details visible
    expect(screen.getByText("Explore")).toBeInTheDocument();
    expect(screen.getByText("Searching codebase")).toBeInTheDocument();
    expect(screen.getByText("Plan")).toBeInTheDocument();
    expect(screen.getByText("Architecture review")).toBeInTheDocument();
  });

  it("shows both tasks and agents sections with divider", () => {
    const tasks = [
      task({ id: "1", subject: "Fix bug", status: "in_progress" }),
    ];
    const agents = [
      agent({ toolId: "a1", subagentType: "Explore", description: "Search", isRunning: true }),
    ];
    render(
      <TaskTracker
        tasks={tasks}
        currentTask={tasks[0]}
        counts={counts(tasks)}
        backgroundAgents={agents}
        backgroundRunningCount={1}
      />,
    );

    // Both sections visible
    expect(screen.getByText("Fix bug")).toBeInTheDocument();
    expect(screen.getByText("1 background agent running")).toBeInTheDocument();
  });

  it("shows completed/total badge for background agents", () => {
    const agents = [
      agent({ toolId: "a1", subagentType: "Explore", isRunning: false }),
      agent({ toolId: "a2", subagentType: "Plan", isRunning: true }),
      agent({ toolId: "a3", subagentType: "Bash", isRunning: false }),
    ];
    render(
      <TaskTracker
        tasks={[]}
        currentTask={undefined}
        counts={{ total: 0, completed: 0, inProgress: 0, pending: 0 }}
        backgroundAgents={agents}
        backgroundRunningCount={1}
      />,
    );

    // 2 completed out of 3
    expect(screen.getByText("2/3")).toBeInTheDocument();
  });

  // ── Expanded agent details ────────────────────────────────────────

  it("collapses background agents on second click", async () => {
    const user = userEvent.setup();
    const agents = [
      agent({ toolId: "a1", subagentType: "Explore", description: "Searching files", isRunning: true }),
    ];
    render(
      <TaskTracker
        tasks={[]}
        currentTask={undefined}
        counts={{ total: 0, completed: 0, inProgress: 0, pending: 0 }}
        backgroundAgents={agents}
        backgroundRunningCount={1}
      />,
    );

    const toggle = screen.getByText("1 background agent running");
    await user.click(toggle);
    expect(screen.getByText("Searching files")).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.queryByText("Searching files")).not.toBeInTheDocument();
  });

  it("tasks and agents sections expand independently", async () => {
    const user = userEvent.setup();
    const tasks = [
      task({ id: "1", subject: "Build feature", status: "in_progress" }),
    ];
    const agents = [
      agent({ toolId: "a1", subagentType: "Explore", description: "Agent work", isRunning: true }),
    ];
    render(
      <TaskTracker
        tasks={tasks}
        currentTask={tasks[0]}
        counts={counts(tasks)}
        backgroundAgents={agents}
        backgroundRunningCount={1}
      />,
    );

    // Expand tasks only
    await user.click(screen.getByText("Build feature"));
    expect(screen.getAllByText("Build feature")).toHaveLength(2); // label + expanded
    expect(screen.queryByText("Agent work")).not.toBeInTheDocument();

    // Expand agents too
    await user.click(screen.getByText("1 background agent running"));
    expect(screen.getByText("Agent work")).toBeInTheDocument();
    // Tasks still expanded
    expect(screen.getAllByText("Build feature")).toHaveLength(2);
  });

  it("renders only agents section when tasks is empty but agents exist", () => {
    const agents = [
      agent({ toolId: "a1", subagentType: "Plan", description: "Planning", isRunning: true }),
    ];
    const { container } = render(
      <TaskTracker
        tasks={[]}
        currentTask={undefined}
        counts={{ total: 0, completed: 0, inProgress: 0, pending: 0 }}
        backgroundAgents={agents}
        backgroundRunningCount={1}
      />,
    );

    expect(container.firstChild).not.toBeNull();
    expect(screen.getByText("1 background agent running")).toBeInTheDocument();
    // No task count badge since no tasks
    expect(screen.queryByText("0/0")).not.toBeInTheDocument();
  });

  it("renders only tasks section when agents is empty but tasks exist", () => {
    const tasks = [task({ id: "1", subject: "Do thing", status: "pending" })];
    render(
      <TaskTracker
        tasks={tasks}
        currentTask={undefined}
        counts={counts(tasks)}
        backgroundAgents={[]}
        backgroundRunningCount={0}
      />,
    );

    expect(screen.getByText("1 task remaining")).toBeInTheDocument();
    expect(screen.queryByText(/background agent/)).not.toBeInTheDocument();
  });

  it("does not show divider when only tasks exist (no agents)", () => {
    const tasks = [task({ id: "1", subject: "Work", status: "pending" })];
    const { container } = render(
      <TaskTracker
        tasks={tasks}
        currentTask={undefined}
        counts={counts(tasks)}
        backgroundAgents={[]}
        backgroundRunningCount={0}
      />,
    );

    // The divider has border-border/30 class; shouldn't be present with no agents
    const dividers = container.querySelectorAll(".border-border\\/30");
    expect(dividers).toHaveLength(0);
  });

  it("does not show divider when only agents exist (no tasks)", () => {
    const agents = [
      agent({ toolId: "a1", subagentType: "Explore", isRunning: true }),
    ];
    const { container } = render(
      <TaskTracker
        tasks={[]}
        currentTask={undefined}
        counts={{ total: 0, completed: 0, inProgress: 0, pending: 0 }}
        backgroundAgents={agents}
        backgroundRunningCount={1}
      />,
    );

    const dividers = container.querySelectorAll(".border-border\\/30");
    expect(dividers).toHaveLength(0);
  });

  it("shows divider only when both tasks and agents are present", () => {
    const tasks = [task({ id: "1", subject: "Fix", status: "pending" })];
    const agents = [agent({ toolId: "a1", subagentType: "Explore", isRunning: true })];
    const { container } = render(
      <TaskTracker
        tasks={tasks}
        currentTask={undefined}
        counts={counts(tasks)}
        backgroundAgents={agents}
        backgroundRunningCount={1}
      />,
    );

    const dividers = container.querySelectorAll(".border-border\\/30");
    expect(dividers.length).toBeGreaterThan(0);
  });

  it("shimmer on agent label requires both running count > 0 and isStreaming", () => {
    const agents = [
      agent({ toolId: "a1", subagentType: "Explore", isRunning: true }),
    ];

    // Without isStreaming — no shimmer
    const { rerender } = render(
      <TaskTracker
        tasks={[]}
        currentTask={undefined}
        counts={{ total: 0, completed: 0, inProgress: 0, pending: 0 }}
        backgroundAgents={agents}
        backgroundRunningCount={1}
      />,
    );
    expect(screen.getByText("1 background agent running")).not.toHaveClass("animate-shimmer");

    // With isStreaming — shimmer
    rerender(
      <TaskTracker
        tasks={[]}
        currentTask={undefined}
        counts={{ total: 0, completed: 0, inProgress: 0, pending: 0 }}
        backgroundAgents={agents}
        backgroundRunningCount={1}
        isStreaming
      />,
    );
    expect(screen.getByText("1 background agent running")).toHaveClass("animate-shimmer");
  });

  it("does not shimmer agent label when backgroundRunningCount is 0 even if streaming", () => {
    const agents = [
      agent({ toolId: "a1", subagentType: "Explore", isRunning: false }),
    ];
    render(
      <TaskTracker
        tasks={[]}
        currentTask={undefined}
        counts={{ total: 0, completed: 0, inProgress: 0, pending: 0 }}
        backgroundAgents={agents}
        backgroundRunningCount={0}
        isStreaming
      />,
    );
    expect(screen.getByText("All background agents completed")).not.toHaveClass("animate-shimmer");
  });

  it("defaults backgroundAgents prop to empty array", () => {
    const tasks = [task({ id: "1", subject: "Solo", status: "pending" })];
    render(
      <TaskTracker tasks={tasks} currentTask={undefined} counts={counts(tasks)} />,
    );
    // Should render tasks section without errors
    expect(screen.getByText("1 task remaining")).toBeInTheDocument();
    expect(screen.queryByText(/background agent/)).not.toBeInTheDocument();
  });

  it("shows correct label for exactly 0/N agents badge", () => {
    const agents = [
      agent({ toolId: "a1", subagentType: "Explore", isRunning: true }),
      agent({ toolId: "a2", subagentType: "Plan", isRunning: true }),
    ];
    render(
      <TaskTracker
        tasks={[]}
        currentTask={undefined}
        counts={{ total: 0, completed: 0, inProgress: 0, pending: 0 }}
        backgroundAgents={agents}
        backgroundRunningCount={2}
      />,
    );
    // 0 completed out of 2
    expect(screen.getByText("0/2")).toBeInTheDocument();
  });
});
