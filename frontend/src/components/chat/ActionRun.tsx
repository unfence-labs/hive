import { useMemo, useState } from "react";
import { XCircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  RUN_COLLAPSE_THRESHOLD,
  findLiveStep,
  liveLabel,
  pastLabel,
  summarizeRun,
  type TimelineStep,
} from "@/lib/timeline-steps";
import { useCoalescedValue } from "@/hooks/useCoalescedValue";
import { StepIconGlyph } from "@/components/chat/StepIcon";
import { STEP_LINE_CLASS, STEP_LIST_CLASS } from "@/components/chat/StepRow";
import { AgentStep, StepItem } from "@/components/chat/AgentStep";

const LIVE_LABEL_WINDOW_MS = 200;
const HEADER_CLASS = `${STEP_LINE_CLASS} cursor-pointer hover:bg-muted/60 hover:text-foreground`;

interface ActionRunProps {
  steps: TimelineStep[];
  streaming: boolean;
}

export function ActionRun({ steps, streaming }: ActionRunProps) {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const summary = summarizeRun(steps);

  const labelStep = findLiveStep(steps) ?? steps[steps.length - 1];
  const running = labelStep.status === "running";
  const label = running ? liveLabel(labelStep) : pastLabel(labelStep);
  const icon = labelStep.icon;
  const live = useCoalescedValue(useMemo(() => ({ icon, running, label }), [icon, running, label]), LIVE_LABEL_WINDOW_MS);

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
        <button type="button" className={HEADER_CLASS} onClick={toggle} aria-expanded={open}>
          <StepIconGlyph icon={live.icon} className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{live.label}</span>
          {" · "}
          <span className="shrink-0">{summary.total} action{summary.total === 1 ? "" : "s"}</span>
          {failedMark}
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
