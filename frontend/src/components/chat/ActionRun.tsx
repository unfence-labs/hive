import { useState } from "react";
import { XCircleIcon } from "lucide-react";
import {
  RUN_COLLAPSE_THRESHOLD,
  findLiveStep,
  summarizeRun,
  type TimelineStep,
} from "@/lib/timeline-steps";
import { useCoalescedValue } from "@/hooks/useCoalescedValue";
import { StepIconGlyph } from "@/components/chat/StepIcon";
import { STEP_LINE_CLASS, STEP_LIST_CLASS, StepLineContent } from "@/components/chat/StepRow";
import { AgentStep, StepItem } from "@/components/chat/AgentStep";

const LIVE_STEP_WINDOW_MS = 200;
const HEADER_CLASS = `${STEP_LINE_CLASS} cursor-pointer hover:bg-muted/60 hover:text-foreground`;

interface ActionRunProps {
  steps: TimelineStep[];
  streaming: boolean;
}

export function ActionRun({ steps, streaming }: ActionRunProps) {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const summary = summarizeRun(steps);

  // The live line is the current step's own line; a new tool or a status change swaps it.
  const labelStep = findLiveStep(steps) ?? steps[steps.length - 1];
  const stepKey = (step: TimelineStep) => `${step.id}:${step.status}`;
  const liveKey = useCoalescedValue(stepKey(labelStep), LIVE_STEP_WINDOW_MS);
  const liveStep = steps.find((step) => stepKey(step) === liveKey) ?? labelStep;

  const flat = !streaming && steps.length < RUN_COLLAPSE_THRESHOLD;
  // Running agents stay visible under the collapsed live header; the open list already holds them.
  const liveAgents = streaming && !open ? steps.filter((step) => step.kind === "agent" && step.status === "running") : [];
  const toggle = () => {
    setOpen(!open);
    setOpened(true);
  };
  const failedMark = summary.failed > 0 && (
    <span className="inline-flex shrink-0 items-center gap-0.5 text-destructive" aria-label={`${summary.failed} failed`}>
      <XCircleIcon className="size-3.5" aria-hidden="true" />
      <span aria-hidden="true">{summary.failed}</span>
    </span>
  );

  return (
    <div>
      {streaming ? (
        <button type="button" className={HEADER_CLASS} onClick={toggle} aria-expanded={open} data-testid="live-line">
          <span className="sr-only">Current step: </span>
          <StepLineContent step={liveStep} live />
        </button>
      ) : !flat && (
        <button type="button" className={HEADER_CLASS} onClick={toggle} aria-expanded={open}>
          <span className="flex shrink-0 items-center gap-1 text-muted-foreground/50">
            {summary.icons.map((stepIcon) => <StepIconGlyph key={stepIcon} icon={stepIcon} className="size-3.5" />)}
          </span>
          <span className="truncate">{summary.label}</span>
          {failedMark}
        </button>
      )}
      {liveAgents.length > 0 && (
        <div className={STEP_LIST_CLASS}>
          {liveAgents.map((step) => <AgentStep key={step.id} step={step} streaming={streaming} />)}
        </div>
      )}
      {(flat || opened) && (
        <div hidden={!flat && !open} className={STEP_LIST_CLASS}>
          {steps.map((step) => <StepItem key={step.id} step={step} streaming={streaming} />)}
        </div>
      )}
    </div>
  );
}
