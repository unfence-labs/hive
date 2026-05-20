import { useState, memo } from "react";
import { ChevronRightIcon, TargetIcon, XCircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TrackedTask, TaskCounts } from "@/hooks/useTasks";
import type { BackgroundAgent } from "@/hooks/useBackgroundAgents";
import type { GoalState } from "@/hooks/useGoalState";

const svgProps = {
  className: "size-3",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function StatusIcon({ status }: { status: TrackedTask["status"] }) {
  switch (status) {
    case "completed":
      return (
        <svg {...svgProps} className="size-3 text-green-500">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
    case "in_progress":
      return (
        <span className="inline-block size-2 animate-pulse rounded-full bg-primary" />
      );
    case "failed":
    case "declined":
      return <XCircleIcon className="size-3 text-destructive" />;
    default:
      return (
        <svg {...svgProps} className="size-3 text-muted-foreground/40">
          <circle cx="12" cy="12" r="10" />
        </svg>
      );
  }
}

function AgentStatusIcon({ isRunning }: { isRunning: boolean }) {
  if (isRunning) {
    return (
      <span className="inline-block size-2 animate-pulse rounded-full bg-primary" />
    );
  }
  return (
    <svg {...svgProps} className="size-3 text-green-500">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function formatGoalStatus(status: string | undefined): string {
  const normalized = status
    ?.trim()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .toLowerCase();
  switch (normalized) {
    case undefined:
    case "":
    case "running":
    case "in progress":
      return "active";
    case "paused":
      return "paused";
    case "blocked":
      return "blocked";
    case "usage limited":
      return "usage limited";
    case "budget limited":
      return "budget limited";
    case "complete":
    case "completed":
      return "complete";
    default:
      return normalized;
  }
}

function formatCompactCount(value: number): string {
  if (value < 1_000) return String(value);
  if (value < 1_000_000) {
    const thousands = value / 1_000;
    const formatted = thousands >= 10
      ? String(Math.round(thousands))
      : thousands.toFixed(1).replace(/\.0$/, "");
    return `${formatted}k`;
  }
  const millions = value / 1_000_000;
  return `${millions.toFixed(1).replace(/\.0$/, "")}m`;
}

function formatGoalProgress(goal: GoalState): string | null {
  const tokensUsed = typeof goal.tokensUsed === "number" ? goal.tokensUsed : null;
  const tokenBudget = typeof goal.tokenBudget === "number" ? goal.tokenBudget : null;
  if (tokensUsed != null && tokenBudget != null) {
    return `${formatCompactCount(tokensUsed)}/${formatCompactCount(tokenBudget)}`;
  }
  if (tokensUsed != null) return `${formatCompactCount(tokensUsed)} used`;
  if (tokenBudget != null) return `0/${formatCompactCount(tokenBudget)}`;
  return null;
}

function formatGoalElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const remainderSeconds = total % 60;
  if (minutes < 60) return remainderSeconds > 0 ? `${minutes}m ${remainderSeconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  return remainderMinutes > 0 ? `${hours}h ${remainderMinutes}m` : `${hours}h`;
}

interface TaskTrackerProps {
  goal?: GoalState | null;
  tasks: TrackedTask[];
  currentTask: TrackedTask | undefined;
  counts: TaskCounts;
  isStreaming?: boolean;
  backgroundAgents?: BackgroundAgent[];
  backgroundRunningCount?: number;
}

const TaskTracker = memo(function TaskTracker({
  goal,
  tasks,
  currentTask,
  counts,
  isStreaming,
  backgroundAgents = [],
  backgroundRunningCount = 0,
}: TaskTrackerProps) {
  const [goalExpanded, setGoalExpanded] = useState(false);
  const [tasksExpanded, setTasksExpanded] = useState(false);
  const [agentsExpanded, setAgentsExpanded] = useState(false);

  const hasGoal = goal != null;
  const hasTasks = tasks.length > 0;
  const hasAgents = backgroundAgents.length > 0;

  if (!hasGoal && !hasTasks && !hasAgents) return null;

  const allDone = counts.completed === counts.total;
  const remaining = counts.total - counts.completed;
  const hasOnlyOpenTasks = remaining === counts.pending + counts.inProgress;
  const collapsedLabel = currentTask
    ? (currentTask.activeForm ?? currentTask.subject)
    : allDone
      ? "All tasks completed"
      : hasOnlyOpenTasks
        ? `${remaining} task${remaining === 1 ? "" : "s"} remaining`
        : `${remaining} task${remaining === 1 ? "" : "s"} not completed`;

  const agentLabel = backgroundRunningCount > 0
    ? `${backgroundRunningCount} background agent${backgroundRunningCount !== 1 ? "s" : ""} running`
    : "All background agents completed";
  const goalObjective = goal?.objective?.trim() || "Goal running";
  const goalStatus = goal ? formatGoalStatus(goal.status) : "";
  const goalProgress = goal ? formatGoalProgress(goal) : null;
  const goalElapsed = typeof goal?.timeUsedSeconds === "number" ? formatGoalElapsed(goal.timeUsedSeconds) : null;
  const goalMeta = [goalStatus, goalProgress, goalElapsed].filter(Boolean);

  return (
    <div className="border-t border-border/50 bg-background px-4 py-1.5">
      {/* Goal section */}
      {hasGoal && (
        <>
          <button
            type="button"
            className="inline-flex w-full items-center gap-2 rounded-md py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setGoalExpanded(!goalExpanded)}
          >
            <ChevronRightIcon
              className={cn(
                "size-3.5 shrink-0 transition-transform",
                goalExpanded && "rotate-90",
              )}
            />
            <TargetIcon className="size-3 shrink-0 text-primary/80" />
            <span
              className={cn(
                "min-w-0 truncate",
                isStreaming && goal.status !== "complete" && goal.status !== "completed" && "animate-shimmer",
              )}
            >
              {goalObjective}
            </span>
            {goalMeta.length > 0 && (
              <span className="ml-auto shrink-0 text-[11px] font-normal text-muted-foreground/60">
                {goalMeta.join(" · ")}
              </span>
            )}
          </button>

          {goalExpanded && (
            <div className="mt-1 space-y-0.5 pb-0.5 pl-5 text-xs text-muted-foreground">
              <div className="flex items-center gap-2 py-0.5">
                <span className="shrink-0 font-medium text-muted-foreground/70">Goal</span>
                <span className="min-w-0 truncate text-foreground">{goalObjective}</span>
              </div>
              <div className="flex items-center gap-2 py-0.5 text-[11px] text-muted-foreground/60">
                <span>{goalStatus}</span>
                {goalProgress && (
                  <>
                    <span>·</span>
                    <span>{goalProgress}</span>
                  </>
                )}
                {goalElapsed && (
                  <>
                    <span>·</span>
                    <span>{goalElapsed}</span>
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {hasGoal && (hasTasks || hasAgents) && (
        <div className="my-1 border-t border-border/30" />
      )}

      {/* Tasks section */}
      {hasTasks && (
        <>
          <button
            type="button"
            className="inline-flex w-full items-center gap-2 rounded-md py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setTasksExpanded(!tasksExpanded)}
          >
            <ChevronRightIcon
              className={cn(
                "size-3.5 shrink-0 transition-transform",
                tasksExpanded && "rotate-90",
              )}
            />
            <span
              className={cn(
                "min-w-0 truncate",
                currentTask && isStreaming && "animate-shimmer",
              )}
            >
              {collapsedLabel}
            </span>
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground/50">
              {counts.completed}/{counts.total}
            </span>
          </button>

          {tasksExpanded && (
            <div className="mt-1 space-y-0.5 pb-0.5">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center gap-2 py-0.5 pl-5 text-xs text-muted-foreground"
                >
                  <span className="flex shrink-0 items-center justify-center" style={{ width: 12 }}>
                    <StatusIcon status={task.status} />
                  </span>
                  <span
                    className={cn(
                      "min-w-0 truncate",
                      task.status === "completed" && "line-through text-muted-foreground/50",
                      task.status === "in_progress" && "text-foreground",
                      (task.status === "failed" || task.status === "declined") && "text-destructive",
                    )}
                  >
                    {task.status === "in_progress"
                      ? (task.activeForm ?? task.subject)
                      : task.subject}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Divider between sections */}
      {hasTasks && hasAgents && (
        <div className="my-1 border-t border-border/30" />
      )}

      {/* Background agents section */}
      {hasAgents && (
        <>
          <button
            type="button"
            className="inline-flex w-full items-center gap-2 rounded-md py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setAgentsExpanded(!agentsExpanded)}
          >
            <ChevronRightIcon
              className={cn(
                "size-3.5 shrink-0 transition-transform",
                agentsExpanded && "rotate-90",
              )}
            />
            <span
              className={cn(
                "min-w-0 truncate",
                backgroundRunningCount > 0 && isStreaming && "animate-shimmer",
              )}
            >
              {agentLabel}
            </span>
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground/50">
              {backgroundAgents.length - backgroundRunningCount}/{backgroundAgents.length}
            </span>
          </button>

          {agentsExpanded && (
            <div className="mt-1 space-y-0.5 pb-0.5">
              {backgroundAgents.map((agent) => (
                <div
                  key={agent.toolId}
                  className="flex items-center gap-2 py-0.5 pl-5 text-xs text-muted-foreground"
                >
                  <span className="flex shrink-0 items-center justify-center" style={{ width: 12 }}>
                    <AgentStatusIcon isRunning={agent.isRunning} />
                  </span>
                  <span className="shrink-0 font-medium text-muted-foreground/70">
                    {agent.subagentType}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 truncate",
                      agent.isRunning ? "text-foreground" : "text-muted-foreground/50",
                    )}
                  >
                    {agent.description}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
});

export default TaskTracker;
