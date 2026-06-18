import { useState, memo } from "react";
import { ChevronRightIcon, CircleDashedIcon, XCircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TrackedTask, TaskCounts, TaskTrackerStatus } from "@/hooks/useTasks";
import type { BackgroundAgent } from "@/hooks/useBackgroundAgents";
import type { GoalState } from "@/hooks/useGoalState";
import { formatTokenCount } from "@/lib/format-usage";

const svgProps = {
  className: "size-3",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function StatusIcon({ status, unconfirmed }: { status: TrackedTask["status"]; unconfirmed?: boolean }) {
  if (unconfirmed && (status === "pending" || status === "in_progress")) {
    return <CircleDashedIcon className="size-3 text-muted-foreground/50" />;
  }

  switch (status) {
    case "completed":
      return (
        <svg {...svgProps} className="size-3 text-success-foreground">
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
    <svg {...svgProps} className="size-3 text-success-foreground">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function normalizeGoalStatus(status: string | undefined): string {
  return status
    ?.trim()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .toLowerCase() ?? "";
}

function formatGoalHeader(status: string | undefined): string {
  const normalized = normalizeGoalStatus(status);
  switch (normalized) {
    case "":
    case "running":
    case "in progress":
      return "Goal running";
    case "complete":
    case "completed":
      return "Goal reached";
    case "paused":
      return "Goal paused";
    case "blocked":
      return "Goal blocked";
    case "usage limited":
      return "Goal usage limited";
    case "budget limited":
      return "Goal budget limited";
    default:
      return `Goal ${normalized}`;
  }
}

function isGoalComplete(status: string | undefined): boolean {
  const normalized = normalizeGoalStatus(status);
  return normalized === "complete" || normalized === "completed";
}

function formatGoalTokens(goal: GoalState): string | null {
  const tokensUsed = typeof goal.tokensUsed === "number" ? goal.tokensUsed : null;
  const tokenBudget = typeof goal.tokenBudget === "number" ? goal.tokenBudget : null;
  if (tokensUsed != null && tokenBudget != null) {
    return `${formatTokenCount(tokensUsed)}/${formatTokenCount(tokenBudget)}`;
  }
  if (tokensUsed != null) return `${formatTokenCount(tokensUsed)} used`;
  if (tokenBudget != null) return `0/${formatTokenCount(tokenBudget)}`;
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
  trackerStatus?: TaskTrackerStatus;
  isStreaming?: boolean;
  backgroundAgents?: BackgroundAgent[];
  backgroundRunningCount?: number;
}

const TaskTracker = memo(function TaskTracker({
  goal,
  tasks,
  currentTask,
  counts,
  trackerStatus = "live",
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

  const isUnconfirmed = trackerStatus === "unconfirmed";
  const allDone = counts.completed === counts.total;
  const remaining = counts.total - counts.completed;
  const unconfirmedCount = counts.pending + counts.inProgress;
  const hasOnlyOpenTasks = remaining === counts.pending + counts.inProgress;
  const collapsedLabel = isUnconfirmed
    ? `${unconfirmedCount} task${unconfirmedCount === 1 ? "" : "s"} unconfirmed`
    : currentTask
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
  const goalHeader = goal ? formatGoalHeader(goal.status) : "Goal running";
  const goalTokens = goal ? formatGoalTokens(goal) : null;
  const goalElapsed = typeof goal?.timeUsedSeconds === "number" ? formatGoalElapsed(goal.timeUsedSeconds) : null;
  const goalComplete = goal ? isGoalComplete(goal.status) : false;
  const goalHeaderMeta = [goalTokens, goalElapsed].filter(Boolean);

  return (
    <div className="border-t border-border/50 px-4 py-2">
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
            <span
              className={cn(
                "min-w-0 truncate",
                isStreaming && !goalComplete && "animate-shimmer",
              )}
              title={goalObjective}
            >
              {goalHeader}
            </span>
            {goalHeaderMeta.length > 0 && (
              <span className="ml-auto shrink-0 text-[11px] font-normal text-muted-foreground/50">
                {goalHeaderMeta.join(" · ")}
              </span>
            )}
          </button>

          {goalExpanded && (
            <div className="mt-1 flex items-start gap-2 pb-0.5 pl-5 text-xs text-muted-foreground">
              <span className="flex shrink-0 items-center justify-center pt-1" style={{ width: 12 }}>
                <StatusIcon status={goalComplete ? "completed" : "pending"} />
              </span>
              <span className="min-w-0 whitespace-pre-wrap break-words font-medium leading-relaxed">
                {goalObjective}
              </span>
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
                currentTask && isStreaming && !isUnconfirmed && "animate-shimmer",
              )}
              title={isUnconfirmed ? "Codex finished before reporting a final plan update" : undefined}
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
                    <StatusIcon status={task.status} unconfirmed={isUnconfirmed} />
                  </span>
                  <span
                    className={cn(
                      "min-w-0 truncate",
                      task.status === "completed" && "line-through text-muted-foreground/50",
                      task.status === "in_progress" && (isUnconfirmed ? "text-muted-foreground/60" : "text-foreground"),
                      isUnconfirmed && task.status === "pending" && "text-muted-foreground/60",
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
