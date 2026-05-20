import { memo, useState, type ReactNode } from "react";
import {
  AlertTriangleIcon,
  ChevronRightIcon,
  XCircleIcon,
} from "lucide-react";
import { commandExecutionActivityToToolCall } from "@hive/shared/agent-activity";
import type { AgentActivity, QuestionAnswer, ToolCall } from "@/types";
import { cn } from "@/lib/utils";
import { ContentPanel, ContentPanelBody } from "@/components/chat/ContentPanel";
import ChatToolUse, { ToolExpandedContent } from "@/components/ChatToolUse";
import { ToolCallList } from "@/components/chat/ToolCallList";
import type { PlanStatus } from "@/components/chat/PlanProposal";

type InlineAgentActivity = Exclude<AgentActivity, { kind: "plan_update" }>;

interface AgentActivityListProps {
  activities: AgentActivity[];
  toolCalls?: ToolCall[];
  showExecutingState?: boolean;
  isInteractive?: boolean;
  planStatus?: PlanStatus;
  dismissedToolCallIds?: Set<string>;
  onQuestionAnswer?: (toolCallId: string, answers: QuestionAnswer[]) => void;
}

export function AgentActivityList({
  activities,
  toolCalls = [],
  showExecutingState,
  isInteractive,
  planStatus,
  dismissedToolCallIds,
  onQuestionAnswer,
}: AgentActivityListProps) {
  const inlineActivities = getInlineAgentActivities(activities);
  if (inlineActivities.length === 0 && toolCalls.length === 0) return null;

  const mergedToolCalls = mergeToolCalls(toolCalls, inlineActivities);
  const otherActivities = inlineActivities.filter((activity) => activityToToolCalls(activity).length === 0);

  if (mergedToolCalls.length > 0 && otherActivities.length === 0) {
    return (
      <ToolCallList
        toolCalls={mergedToolCalls}
        isInteractive={isInteractive}
        showExecutingState={showExecutingState}
        planStatus={planStatus}
        dismissedToolCallIds={dismissedToolCallIds}
        onQuestionAnswer={onQuestionAnswer}
      />
    );
  }

  return (
    <div className="mt-2">
      {mergedToolCalls.length > 0 && (
        <ToolCallList
          toolCalls={mergedToolCalls}
          isInteractive={isInteractive}
          showExecutingState={showExecutingState}
          planStatus={planStatus}
          dismissedToolCallIds={dismissedToolCallIds}
          onQuestionAnswer={onQuestionAnswer}
          className="mt-0"
        />
      )}
      {otherActivities.map((activity) => (
        <AgentActivityItem
          key={activity.id}
          activity={activity}
          showExecutingState={showExecutingState}
        />
      ))}
    </div>
  );
}

export function getInlineAgentActivities(activities: AgentActivity[]): InlineAgentActivity[] {
  return activities.filter((activity): activity is InlineAgentActivity => activity.kind !== "plan_update");
}

function mergeToolCalls(toolCalls: ToolCall[], activities: InlineAgentActivity[]): ToolCall[] {
  const toolCallIds = new Set(toolCalls.map((tool) => tool.id));
  const activityToolCalls = activities.flatMap((activity) => {
    if (toolCallIds.has(activity.id)) return [];
    return activityToToolCalls(activity).filter((tool) => !toolCallIds.has(tool.id));
  });
  return [...toolCalls, ...activityToolCalls];
}

function activityToToolCalls(activity: InlineAgentActivity): ToolCall[] {
  switch (activity.kind) {
    case "command_execution":
      return [commandActivityToToolCall(activity)];
    case "file_change":
      return fileChangeActivityToToolCalls(activity);
    case "diagnostic":
      return [];
  }
}

const AgentActivityItem = memo(function AgentActivityItem({
  activity,
  showExecutingState,
}: {
  activity: InlineAgentActivity;
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
    case "diagnostic":
      return <DiagnosticActivity activity={activity} />;
  }
});

function ActivityShell({
  title,
  detail,
  trailingIcon,
  expandedContent,
  defaultOpen = false,
  executing,
}: {
  title: string;
  detail?: ReactNode;
  trailingIcon?: ReactNode;
  expandedContent?: ReactNode;
  defaultOpen?: boolean;
  executing?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const canOpen = Boolean(expandedContent);

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
        <span>{title}</span>
        {detail}
        {trailingIcon && <span className="shrink-0">{trailingIcon}</span>}
        {executing && <span className="inline-block size-1.5 animate-pulse rounded-full bg-primary" />}
      </button>
      {open && expandedContent && (
        <ContentPanel>
          <ContentPanelBody>
            <ToolExpandedContent content={expandedContent} />
          </ContentPanelBody>
        </ContentPanel>
      )}
    </div>
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
      title={activity.title}
      detail={detail}
      trailingIcon={diagnosticIcon(activity.severity)}
      expandedContent={[activity.message, activity.details].filter(Boolean).join("\n\n")}
    />
  );
}

function diagnosticIcon(severity: Extract<AgentActivity, { kind: "diagnostic" }>["severity"]) {
  if (severity === "error") return <XCircleIcon className="size-3.5 text-destructive" aria-label="Diagnostic error" />;
  if (severity === "warning") return <AlertTriangleIcon className="size-3.5 text-amber-500" aria-label="Diagnostic warning" />;
  return undefined;
}

function commandActivityToToolCall(activity: Extract<AgentActivity, { kind: "command_execution" }>): ToolCall {
  return commandExecutionActivityToToolCall(activity);
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
