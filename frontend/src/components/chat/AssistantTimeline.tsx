import { useEffect, useState } from "react";
import type { ChatMessage } from "@/types";
import { findPlanContent } from "@/lib/plan-state";
import { presentStandaloneStep, type PlanStatus, type TimelineRow, type TimelineStep } from "@/lib/timeline-steps";
import { MessageResponse } from "@/components/ai-elements/message";
import { ActionRun } from "@/components/chat/ActionRun";
import { StepRow } from "@/components/chat/StepRow";
import { PlanDetail } from "@/components/chat/StepDetail";

interface AssistantTimelineProps {
  message: ChatMessage;
  rows: TimelineRow[];
  streaming?: boolean;
  isInteractive?: boolean;
  planStatus?: PlanStatus;
  dismissedToolCallIds?: Set<string>;
}

export function AssistantTimeline({
  message,
  rows,
  streaming = false,
  isInteractive,
  planStatus,
  dismissedToolCallIds,
}: AssistantTimelineProps) {
  return (
    <div className="space-y-3">
      {rows.map((row, index) => {
        // A run is live only while nothing follows it; prose or a later step closes it.
        const rowStreaming = streaming && index === rows.length - 1;
        switch (row.type) {
          case "text":
            return (
              <div key={row.id} className="prose-sm" data-find-content="">
                <MessageResponse isAnimating={streaming}>{row.text}</MessageResponse>
              </div>
            );
          case "run":
            return <ActionRun key={row.id} steps={row.steps} streaming={rowStreaming} />;
          case "step": {
            const step = presentStandaloneStep(row.step, {
              isInteractive,
              planStatus,
              dismissed: dismissedToolCallIds?.has(row.step.id),
            });
            if (step.kind === "plan") {
              return <PlanStep key={row.id} step={step} content={resolvePlanContent(message, step.id)} />;
            }
            return <StepRow key={row.id} step={step} />;
          }
        }
      })}
    </div>
  );
}

/** Open while awaiting the user, collapses once approved or revised; reopens only on click. */
function PlanStep({ step, content }: { step: TimelineStep; content?: string }) {
  const awaiting = step.status === "running";
  const [open, setOpen] = useState(awaiting);

  useEffect(() => {
    if (!awaiting) setOpen(false);
  }, [awaiting]);

  return (
    <StepRow
      step={step}
      open={open}
      onOpenChange={setOpen}
      detail={content ? <PlanDetail content={content} /> : null}
    />
  );
}

/** Resolve against preceding tools only, never a later plan revision. */
function resolvePlanContent(message: ChatMessage, planToolId: string): string | undefined {
  const tools = message.toolCalls ?? [];
  const index = tools.findIndex((tool) => tool.id === planToolId);
  return findPlanContent(tools.slice(0, index + 1))?.content;
}
