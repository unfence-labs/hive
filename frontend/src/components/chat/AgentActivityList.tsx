import { memo, useState, type ReactNode } from "react";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleIcon,
  InfoIcon,
  ListChecksIcon,
  Loader2Icon,
  XCircleIcon,
} from "lucide-react";
import type { AgentActivity, ToolCall } from "@/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ContentPanel, ContentPanelBody } from "@/components/chat/ContentPanel";
import ChatToolUse from "@/components/ChatToolUse";

interface AgentActivityListProps {
  activities: AgentActivity[];
  showExecutingState?: boolean;
}

export function AgentActivityList({ activities, showExecutingState }: AgentActivityListProps) {
  if (activities.length === 0) return null;

  return (
    <div className="mt-2">
      {activities.map((activity) => (
        <AgentActivityItem
          key={activity.id}
          activity={activity}
          showExecutingState={showExecutingState}
        />
      ))}
    </div>
  );
}

const AgentActivityItem = memo(function AgentActivityItem({
  activity,
  showExecutingState,
}: {
  activity: AgentActivity;
  showExecutingState?: boolean;
}) {
  switch (activity.kind) {
    case "command_execution":
      return (
        <ChatToolUse
          tool={commandActivityToToolCall(activity)}
          isExecuting={isCommandRunning(activity, showExecutingState)}
        />
      );
    case "file_change":
      return (
        <>
          {fileChangeActivityToToolCalls(activity).map((tool) => (
            <ChatToolUse key={tool.id} tool={tool} />
          ))}
        </>
      );
    case "plan_update":
      return <PlanUpdateActivity activity={activity} />;
    case "diagnostic":
      return <DiagnosticActivity activity={activity} />;
  }
});

function ActivityShell({
  icon,
  title,
  detail,
  status,
  children,
  defaultOpen = false,
  executing,
}: {
  icon: ReactNode;
  title: string;
  detail?: ReactNode;
  status?: string;
  children?: ReactNode;
  defaultOpen?: boolean;
  executing?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const canOpen = Boolean(children);

  return (
    <div className="my-0.5">
      <button
        type="button"
        className={cn(
          "inline-flex w-fit max-w-full items-center gap-2 rounded-md py-1 pr-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground",
          executing && "animate-shimmer",
        )}
        onClick={() => canOpen && setOpen(!open)}
        aria-expanded={canOpen ? open : undefined}
      >
        {canOpen && (
          <ChevronRightIcon className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
        )}
        <span className="shrink-0">{icon}</span>
        <span>{title}</span>
        {detail}
        {status && <StatusBadge status={status} />}
        {executing && <span className="inline-block size-1.5 animate-pulse rounded-full bg-primary" />}
      </button>
      {open && children && <ContentPanel>{children}</ContentPanel>}
    </div>
  );
}

function PlanUpdateActivity({ activity }: { activity: Extract<AgentActivity, { kind: "plan_update" }> }) {
  const complete = activity.steps.filter((step) => step.status === "completed").length;
  const detail = (
    <span className="text-xs font-normal text-muted-foreground/70">
      {complete}/{activity.steps.length} complete
    </span>
  );

  return (
    <ActivityShell
      icon={<ListChecksIcon className="size-3.5" />}
      title="Plan"
      detail={detail}
      defaultOpen={activity.steps.some((step) => step.status === "inProgress")}
    >
      <ContentPanelBody>
        <div className="space-y-2">
          {activity.steps.map((step, index) => (
            <div key={`${index}-${step.text}`} className="flex min-w-0 items-start gap-2 text-sm">
              <span className="mt-0.5 shrink-0">{planStepIcon(step.status)}</span>
              <span className={cn(step.status === "completed" && "text-muted-foreground line-through")}>
                {step.text}
              </span>
            </div>
          ))}
        </div>
      </ContentPanelBody>
    </ActivityShell>
  );
}

function DiagnosticActivity({ activity }: { activity: Extract<AgentActivity, { kind: "diagnostic" }> }) {
  const detail = activity.method ? (
    <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
      {activity.method}
    </code>
  ) : undefined;

  return (
    <ActivityShell
      icon={diagnosticIcon(activity.severity)}
      title={activity.title}
      detail={detail}
      status={activity.severity}
    >
      <ContentPanelBody>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{activity.message}</p>
          {activity.details && (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border border-border/30 bg-muted/30 p-2 font-mono text-xs text-muted-foreground">
              {activity.details}
            </pre>
          )}
        </div>
      </ContentPanelBody>
    </ActivityShell>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className="text-[10px]">
      {readableStatus(status)}
    </Badge>
  );
}

function planStepIcon(status: string) {
  if (status === "completed") return <CheckCircle2Icon className="size-3.5 text-green-500" />;
  if (status === "inProgress") return <Loader2Icon className="size-3.5 animate-spin text-primary" />;
  if (status === "failed" || status === "declined") return <XCircleIcon className="size-3.5 text-destructive" />;
  return <CircleIcon className="size-3.5 text-muted-foreground/60" />;
}

function diagnosticIcon(severity: Extract<AgentActivity, { kind: "diagnostic" }>["severity"]) {
  if (severity === "error") return <XCircleIcon className="size-3.5 text-destructive" />;
  if (severity === "warning") return <AlertTriangleIcon className="size-3.5 text-amber-500" />;
  return <InfoIcon className="size-3.5 text-muted-foreground" />;
}

function readableStatus(status: string): string {
  return status
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (char) => char.toUpperCase());
}

function commandActivityToToolCall(activity: Extract<AgentActivity, { kind: "command_execution" }>): ToolCall {
  return {
    id: activity.id,
    name: "Bash",
    input: JSON.stringify({
      command: activity.command,
      cwd: activity.cwd,
      status: activity.status,
      exitCode: activity.exitCode,
      durationMs: activity.durationMs,
    }),
    output: activity.output,
  };
}

function isCommandRunning(
  activity: Extract<AgentActivity, { kind: "command_execution" }>,
  showExecutingState: boolean | undefined,
): boolean {
  return Boolean(showExecutingState && (!activity.status || activity.status === "inProgress"));
}

function fileChangeActivityToToolCalls(activity: Extract<AgentActivity, { kind: "file_change" }>): ToolCall[] {
  if (activity.files.length === 0) {
    return [{
      id: activity.id,
      name: "Edit",
      input: JSON.stringify({ filename: "", diff: "", status: activity.status }),
      output: activity.status,
    }];
  }

  return activity.files.map((file, index) => ({
    id: `${activity.id}:${index}:${file.path}`,
    name: "Edit",
    input: JSON.stringify({
      filename: file.path,
      diff: file.diff ?? "",
      kind: file.kind,
      status: file.status ?? activity.status,
    }),
    output: file.diff ?? file.status ?? activity.status,
  }));
}
