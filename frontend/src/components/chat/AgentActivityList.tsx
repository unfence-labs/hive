import { memo } from "react";
import { AlertTriangleIcon, BotIcon, CirclePauseIcon, FoldVerticalIcon, MessageCircleIcon, XCircleIcon } from "lucide-react";
import { commandExecutionActivityToToolCall } from "@hive/shared/agent-activity";
import type { AgentActivity, QuestionAnswer, ToolCall } from "@/types";
import ChatToolUse from "@/components/ChatToolUse";
import { ToolCallList } from "@/components/chat/ToolCallList";
import { ActivityShell, ActivityDetailChip } from "@/components/chat/ActivityShell";
import { ImageViewActivity, ImageGenerationActivity } from "@/components/chat/ImageActivity";
import type { PlanStatus } from "@/components/chat/PlanProposal";

type SubagentActivity = Extract<AgentActivity, { kind: "subagent_activity" }>;
type ContextCompactionActivity = Extract<AgentActivity, { kind: "context_compaction" }>;
type InlineAgentActivity = Exclude<AgentActivity, { kind: "plan_update" } | { kind: "goal_update" }>;

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
  return activities.filter(
    (activity): activity is InlineAgentActivity =>
      activity.kind !== "plan_update" && activity.kind !== "goal_update",
  );
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
    case "image_view":
    case "image_generation":
    case "diagnostic":
    case "subagent_activity":
    case "context_compaction":
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
    case "image_view":
      return <ImageViewActivity activity={activity} />;
    case "image_generation":
      return <ImageGenerationActivity activity={activity} showExecutingState={showExecutingState} />;
    case "diagnostic":
      return <DiagnosticActivity activity={activity} />;
    case "subagent_activity":
      return <SubagentActivityItem activity={activity} />;
    case "context_compaction":
      return <ContextCompactionActivityItem activity={activity} showExecutingState={showExecutingState} />;
  }
});

function ContextCompactionActivityItem({
  activity,
  showExecutingState,
}: {
  activity: ContextCompactionActivity;
  showExecutingState?: boolean;
}) {
  // Only animate while the turn is live so a stale in-progress record
  // (e.g. a turn that died mid-compaction) never shimmers forever.
  const compacting = Boolean(showExecutingState) && activity.status !== "completed";

  return (
    <ActivityShell
      title={compacting ? "Compacting context…" : "Context compacted"}
      tooltip="Older messages were summarized to free up context"
      icon={<FoldVerticalIcon className="size-3.5" aria-label="Context compaction" />}
      executing={compacting}
    />
  );
}

function SubagentActivityItem({ activity }: { activity: SubagentActivity }) {
  return (
    <ActivityShell
      title={subagentActivityTitle(activity.activityKind)}
      icon={subagentActivityIcon(activity.activityKind)}
      detail={<AgentPathChip path={activity.agentPath} />}
    />
  );
}

function AgentPathChip({ path }: { path: string }) {
  return (
    <span
      className="min-w-0 max-w-[min(28rem,60vw)] truncate"
      title={path}
      aria-label={`Agent path: ${path}`}
    >
      <ActivityDetailChip text={path} />
    </span>
  );
}

function subagentActivityTitle(activityKind: SubagentActivity["activityKind"]): string {
  switch (activityKind) {
    case "started":
      return "Started sub-agent";
    case "interacted":
      return "Interacted with sub-agent";
    case "interrupted":
      return "Interrupted sub-agent";
  }
}

function subagentActivityIcon(activityKind: SubagentActivity["activityKind"]) {
  if (activityKind === "interrupted") {
    return <CirclePauseIcon className="size-3.5 text-muted-foreground" aria-label="Sub-agent interrupted" />;
  }

  if (activityKind === "interacted") {
    return <MessageCircleIcon className="size-3.5" aria-label="Sub-agent interaction" />;
  }

  return <BotIcon className="size-3.5" aria-label="Sub-agent started" />;
}

function DiagnosticActivity({ activity }: { activity: Extract<AgentActivity, { kind: "diagnostic" }> }) {
  const detail = activity.method ? <ActivityDetailChip text={activity.method} /> : undefined;

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
  if (severity === "warning") return <AlertTriangleIcon className="size-3.5 text-warning-foreground" aria-label="Diagnostic warning" />;
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
