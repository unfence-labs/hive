import { memo, useState, type ReactNode } from "react";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleIcon,
  FilePenLineIcon,
  InfoIcon,
  ListChecksIcon,
  Loader2Icon,
  TerminalIcon,
  XCircleIcon,
} from "lucide-react";
import type { AgentActivity, AgentActivityFile } from "@/types";
import { cn } from "@/lib/utils";
import { formatElapsed } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { ContentPanel, ContentPanelBody } from "@/components/chat/ContentPanel";
import { DiffView } from "@/components/diff/DiffView";

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
      return <CommandExecutionActivity activity={activity} showExecutingState={showExecutingState} />;
    case "file_change":
      return <FileChangeActivity activity={activity} />;
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

function CommandExecutionActivity({
  activity,
  showExecutingState,
}: {
  activity: Extract<AgentActivity, { kind: "command_execution" }>;
  showExecutingState?: boolean;
}) {
  const command = activity.command ?? "(command pending)";
  const isRunning = showExecutingState && (!activity.status || activity.status === "inProgress");
  const detail = (
    <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
      {command}
    </code>
  );

  return (
    <ActivityShell
      icon={<TerminalIcon className="size-3.5" />}
      title="Command"
      detail={detail}
      status={activity.status}
      defaultOpen={isRunning}
      executing={isRunning}
    >
      <ContentPanelBody>
        <div className="space-y-2">
          <pre className="whitespace-pre-wrap break-all font-mono text-muted-foreground">$ {command}</pre>
          {activity.cwd && (
            <div className="font-mono text-[11px] text-muted-foreground/70">cwd: {activity.cwd}</div>
          )}
          <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            {activity.exitCode !== undefined && <span>exit {activity.exitCode}</span>}
            {activity.durationMs !== undefined && <span>{formatElapsed(activity.durationMs)}</span>}
          </div>
          {activity.output !== undefined && (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border border-border/30 bg-muted/30 p-2 font-mono text-muted-foreground">
              {activity.output || "(no output)"}
            </pre>
          )}
        </div>
      </ContentPanelBody>
    </ActivityShell>
  );
}

function FileChangeActivity({ activity }: { activity: Extract<AgentActivity, { kind: "file_change" }> }) {
  const stats = summarizeFiles(activity.files);
  const detail = (
    <span className="flex min-w-0 items-center gap-2">
      <span className="truncate text-xs font-normal text-muted-foreground/70">
        {activity.files.length} file{activity.files.length !== 1 ? "s" : ""}
      </span>
      {(stats.added > 0 || stats.removed > 0) && (
        <span className="flex items-center gap-1 font-mono text-xs">
          {stats.added > 0 && <span className="text-green-500">+{stats.added}</span>}
          {stats.removed > 0 && <span className="text-red-500">-{stats.removed}</span>}
        </span>
      )}
    </span>
  );

  return (
    <ActivityShell
      icon={<FilePenLineIcon className="size-3.5" />}
      title="File changes"
      detail={detail}
      status={activity.status}
    >
      <ContentPanelBody>
        <div className="space-y-3">
          {activity.files.map((file) => (
            <FileChangeFile key={`${file.path}-${file.kind ?? ""}`} file={file} />
          ))}
        </div>
      </ContentPanelBody>
    </ActivityShell>
  );
}

function FileChangeFile({ file }: { file: AgentActivityFile }) {
  const stats = summarizeDiff(file.diff);

  return (
    <div className="space-y-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
        <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">
          {file.path}
        </code>
        {file.kind && <Badge variant="outline" className="text-[10px]">{readableStatus(file.kind)}</Badge>}
        {(stats.added > 0 || stats.removed > 0) && (
          <span className="flex items-center gap-1 font-mono text-xs">
            {stats.added > 0 && <span className="text-green-500">+{stats.added}</span>}
            {stats.removed > 0 && <span className="text-red-500">-{stats.removed}</span>}
          </span>
        )}
      </div>
      {file.diff ? (
        <DiffView
          filePath={file.path}
          oldText=""
          newText=""
          unifiedDiff={file.diff}
          scrollClassName="max-h-72"
        />
      ) : (
        <div className="text-xs text-muted-foreground">No diff available.</div>
      )}
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

function summarizeFiles(files: AgentActivityFile[]): { added: number; removed: number } {
  return files.reduce(
    (total, file) => {
      const stats = summarizeDiff(file.diff);
      total.added += stats.added;
      total.removed += stats.removed;
      return total;
    },
    { added: 0, removed: 0 },
  );
}

function summarizeDiff(diff: string | undefined): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of (diff ?? "").split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    else if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  return { added, removed };
}
