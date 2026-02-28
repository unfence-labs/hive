import { useState, memo } from "react";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TrackedTask, TaskCounts } from "@/hooks/useTasks";
import type { BackgroundAgent } from "@/hooks/useBackgroundAgents";

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

interface TaskTrackerProps {
  tasks: TrackedTask[];
  currentTask: TrackedTask | undefined;
  counts: TaskCounts;
  isStreaming?: boolean;
  backgroundAgents?: BackgroundAgent[];
  backgroundRunningCount?: number;
}

const TaskTracker = memo(function TaskTracker({
  tasks,
  currentTask,
  counts,
  isStreaming,
  backgroundAgents = [],
  backgroundRunningCount = 0,
}: TaskTrackerProps) {
  const [tasksExpanded, setTasksExpanded] = useState(false);
  const [agentsExpanded, setAgentsExpanded] = useState(false);

  const hasTasks = tasks.length > 0;
  const hasAgents = backgroundAgents.length > 0;

  if (!hasTasks && !hasAgents) return null;

  const allDone = counts.completed === counts.total;
  const collapsedLabel = currentTask
    ? (currentTask.activeForm ?? currentTask.subject)
    : allDone
      ? "All tasks completed"
      : `${counts.pending} task${counts.pending === 1 ? "" : "s"} remaining`;

  const agentLabel = backgroundRunningCount > 0
    ? `${backgroundRunningCount} background agent${backgroundRunningCount !== 1 ? "s" : ""} running`
    : "All background agents completed";

  return (
    <div className="border-t border-border/50 bg-background px-4 py-1.5">
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
