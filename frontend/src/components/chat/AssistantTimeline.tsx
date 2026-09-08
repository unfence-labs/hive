import { useMemo } from "react";
import { XCircleIcon } from "lucide-react";
import type { ChatMessage, ConversationTimelineEntry, ToolCall } from "@/types";
import { isAskUserQuestion, isExitPlanMode } from "@/types";
import { buildChildrenMap } from "@/lib/sub-agent";
import { getSubAgentExecutionState } from "@/lib/sub-agent-status";
import { findPlanContent } from "@/lib/plan-state";
import { getBashMetadata, getToolDisplay } from "@/components/ChatToolUse";
import { MessageResponse } from "@/components/ai-elements/message";
import { ThinkingBlock } from "@/components/chat/ThinkingBlock";
import { ActivityShell } from "@/components/chat/ActivityShell";
import {
  AgentActivityItem,
  activityToToolCalls,
  getInlineAgentActivities,
  type InlineAgentActivity,
} from "@/components/chat/AgentActivityList";
import { ToolCallTree } from "@/components/chat/ToolCallList";
import { AskUserQuestion } from "@/components/chat/AskUserQuestion";
import { PlanProposal, type PlanStatus } from "@/components/chat/PlanProposal";

type Action = { id: string; tool: ToolCall } | { id: string; activity: InlineAgentActivity };
type Row =
  | { type: "actions"; id: string; actions: Action[] }
  | { type: "entry"; id: string; entry: ConversationTimelineEntry };

interface AssistantTimelineProps {
  message: ChatMessage;
  streaming?: boolean;
  isInteractive?: boolean;
  planStatus?: PlanStatus;
  dismissedToolCallIds?: Set<string>;
}

export function AssistantTimeline({
  message,
  streaming,
  isInteractive,
  planStatus,
  dismissedToolCallIds,
}: AssistantTimelineProps) {
  const tools = useMemo(
    () => new Map(message.toolCalls?.map((tool) => [tool.id, tool])),
    [message.toolCalls],
  );
  const activities = useMemo(
    () => new Map(getInlineAgentActivities(message.agentActivities ?? []).map((activity) => [activity.id, activity])),
    [message.agentActivities],
  );
  const childrenMap = useMemo(() => buildChildrenMap(message.toolCalls ?? []), [message.toolCalls]);
  const rows: Row[] = [];
  for (const entry of message.timeline ?? []) {
    let action: Action | undefined;
    if (entry.type === "tool") {
      const tool = tools.get(entry.id);
      if (!tool || tool.parentToolUseId || tool.name === "TaskUpdate" || tool.name === "TodoList") {
        continue;
      }
      if (!isAskUserQuestion(tool) && !isExitPlanMode(tool)) {
        action = { id: entry.id, tool };
      }
    } else if (entry.type === "activity") {
      const activity = activities.get(entry.id);
      if (!activity) continue;
      if (
        activity.kind === "command_execution"
        || activity.kind === "file_change"
        || activity.kind === "subagent_activity"
      ) {
        action = { id: entry.id, activity };
      }
    }
    if (action) {
      const previous = rows.at(-1);
      if (previous?.type === "actions") {
        previous.actions.push(action);
      } else {
        rows.push({ type: "actions", id: `${entry.type}:${entry.id}`, actions: [action] });
      }
    } else {
      rows.push({ type: "entry", id: `${entry.type}:${entry.id}`, entry });
    }
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        if (row.type === "actions") {
          return (
            <TimelineActionGroup
              key={row.id}
              actions={row.actions}
              childrenMap={childrenMap}
              streaming={streaming}
            />
          );
        }
        const entry = row.entry;
        switch (entry.type) {
          case "text":
            return entry.text ? (
              <div key={row.id} className="prose-sm" data-find-content="">
                <MessageResponse isAnimating={streaming}>{entry.text}</MessageResponse>
              </div>
            ) : null;
          case "reasoning":
            return (
              <ThinkingBlock
                key={row.id}
                segments={message.reasoningSegments?.filter((segment) => segment.id.startsWith(`${entry.id}:`))}
                streaming={streaming}
              />
            );
          case "tool": {
            const tool = tools.get(entry.id)!;
            if (isAskUserQuestion(tool)) {
              return (
                <AskUserQuestion
                  key={row.id}
                  tool={tool}
                  isInteractive={isInteractive}
                  isDismissed={dismissedToolCallIds?.has(tool.id)}
                />
              );
            }
            // Resolve against preceding tools across groups, never a later plan revision.
            const toolIndex = message.toolCalls?.findIndex((candidate) => candidate.id === tool.id) ?? -1;
            const plan = findPlanContent(message.toolCalls?.slice(0, toolIndex + 1) ?? []);
            return (
              <PlanProposal
                key={row.id}
                planContent={plan?.content}
                status={planStatus ?? (isInteractive ? "interactive" : "approved")}
              />
            );
          }
          case "activity":
            return (
              <AgentActivityItem
                key={row.id}
                activity={activities.get(entry.id)!}
                showExecutingState={streaming}
              />
            );
        }
      })}
    </div>
  );
}

function TimelineActionGroup({
  actions,
  childrenMap,
  streaming,
}: {
  actions: Action[];
  childrenMap: Map<string, ToolCall[]>;
  streaming?: boolean;
}) {
  const toolState = (tool: ToolCall) => getSubAgentExecutionState(tool, {
    showExecutingState: streaming,
    children: childrenMap.get(tool.id),
    childrenMap,
  });
  const isRunning = (action: Action) => {
    if (!streaming) return false;
    if ("tool" in action) {
      return toolState(action.tool) === "running" || action.tool.output === undefined;
    }
    const activity = action.activity;
    return (activity.kind === "command_execution" || activity.kind === "file_change")
      && (!activity.status || activity.status === "inProgress");
  };
  const hasFailedTool = (tool: ToolCall): boolean => Boolean(
    tool.isError
    || getBashMetadata(tool)?.failed
    || toolState(tool) === "failed"
    || childrenMap.get(tool.id)?.some(hasFailedTool),
  );
  const failed = actions.some((action) => {
    if ("tool" in action) return hasFailedTool(action.tool);
    const activity = action.activity;
    return (activity.kind === "command_execution" && activity.exitCode !== undefined && activity.exitCode !== 0)
      || ((activity.kind === "command_execution" || activity.kind === "file_change") && (activity.status === "failed" || activity.status === "error"))
      || (activity.kind === "file_change" && activity.files.some((file) => file.status === "failed" || file.status === "error"));
  });
  const running = [...actions].reverse().find(isRunning);
  const label = running && "tool" in running ? getToolDisplay(running.tool).label
    : running && "activity" in running && running.activity.kind === "file_change" ? "Editing files"
    : running ? "Running command" : undefined;
  const title = `${actions.length} action${actions.length === 1 ? "" : "s"}${label ? ` · ${label}` : ""}`;

  return (
    <ActivityShell
      title={title}
      executing={Boolean(running)}
      retainContent
      trailingIcon={failed ? (
        <XCircleIcon className="size-3.5 text-destructive" aria-label="Action failed" />
      ) : undefined}
      expandedContent={actions.map((action) => {
        if ("tool" in action) {
          return (
            <ToolCallTree
              key={action.id}
              tools={[action.tool]}
              childrenMap={childrenMap}
              showExecutingState={streaming}
            />
          );
        }
        const converted = activityToToolCalls(action.activity);
        return converted.length > 0 ? (
          <ToolCallTree
            key={action.id}
            tools={converted}
            childrenMap={childrenMap}
            showExecutingState={isRunning(action)}
          />
        ) : (
          <AgentActivityItem
            key={action.id}
            activity={action.activity}
            showExecutingState={streaming}
          />
        );
      })}
    />
  );
}
