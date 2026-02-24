import { useState, memo } from "react";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TrackedTask, TaskCounts } from "@/hooks/useTasks";

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
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
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

interface TaskTrackerProps {
  tasks: TrackedTask[];
  currentTask: TrackedTask | undefined;
  counts: TaskCounts;
  isStreaming?: boolean;
}

const TaskTracker = memo(function TaskTracker({
  tasks,
  currentTask,
  counts,
  isStreaming,
}: TaskTrackerProps) {
  const [expanded, setExpanded] = useState(false);

  if (tasks.length === 0) return null;

  const allDone = counts.completed === counts.total;
  const collapsedLabel = currentTask
    ? (currentTask.activeForm ?? currentTask.subject)
    : allDone
      ? "All tasks completed"
      : `${counts.pending} task${counts.pending === 1 ? "" : "s"} remaining`;

  return (
    <div className="border-t border-border/50 bg-background px-4 py-1.5">
      <button
        type="button"
        className="inline-flex w-full items-center gap-2 rounded-md py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRightIcon
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            expanded && "rotate-90",
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

      {expanded && (
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
    </div>
  );
});

export default TaskTracker;
