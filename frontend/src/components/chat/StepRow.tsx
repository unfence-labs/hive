import { useState, type ReactNode } from "react";
import { AlertTriangleIcon, XCircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TimelineStep } from "@/lib/timeline-steps";
import { getOutputSummary } from "@/lib/tool-display";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { StepIconGlyph } from "@/components/chat/StepIcon";
import { StepDetail, hasStepDetail } from "@/components/chat/StepDetail";

/** Shared line styling for step lines and run headers. */
export const STEP_LINE_CLASS =
  "inline-flex max-w-full items-center gap-2 rounded-md py-1 pr-2 text-[12.5px] text-muted-foreground transition-colors";
/** Steps revealed under a run header sit at the same level as the header: no rail, no indent. */
export const STEP_LIST_CLASS = "space-y-0.5";
const EXPANDABLE_LINE_CLASS = "cursor-pointer hover:bg-muted/60 hover:text-foreground";

interface StepRowProps {
  step: TimelineStep;
  /** Controlled open state; when provided it replaces the internal state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Detail panel content; omitted means the default StepDetail, null means not expandable. */
  detail?: ReactNode;
}

export function StepRow({ step, open: controlledOpen, onOpenChange, detail }: StepRowProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const [opened, setOpened] = useState(open);
  const expandable = detail === undefined ? hasStepDetail(step) : detail !== null;

  if (!expandable) {
    return (
      <div>
        <div className={STEP_LINE_CLASS} title={step.subjectTitle}>
          <StepLineContent step={step} />
        </div>
      </div>
    );
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        setInternalOpen(next);
        onOpenChange?.(next);
        if (next) setOpened(true);
      }}
    >
      <CollapsibleTrigger asChild>
        <button type="button" className={cn(STEP_LINE_CLASS, EXPANDABLE_LINE_CLASS)} title={step.subjectTitle}>
          <StepLineContent step={step} />
        </button>
      </CollapsibleTrigger>
      {opened && (
        <CollapsibleContent forceMount hidden={!open}>
          {detail === undefined ? <StepDetail step={step} /> : detail}
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

/**
 * Icon, subject, verb pill, stats and marks of one step; shared by step lines and the live run line.
 * `live` forces the shimmer: the run header stays alive between tools while the agent keeps working.
 */
export function StepLineContent({ step, live = false }: { step: TimelineStep; live?: boolean }) {
  const running = step.status === "running";
  const shimmer = live || running;
  const failed = step.status === "failed";
  const summary = step.status === "completed" && !step.stats && step.source.type === "tool"
    ? getOutputSummary(step.source.tool)
    : undefined;

  return (
    <>
      <StepIconGlyph
        icon={step.icon}
        className={cn("size-3.5 shrink-0", failed ? "text-destructive" : "text-muted-foreground")}
      />
      {step.subject && (
        <span className={cn("truncate font-mono", shimmer && "step-live-text")}>{step.subject}</span>
      )}
      {step.verb && (
        <>
          {" "}
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[11px] font-medium">
            {running ? step.liveVerb.toLowerCase() : step.verb}
          </span>
        </>
      )}
      {step.stats?.type === "diff" && (
        <>
          {" "}
          <span className="flex shrink-0 items-center gap-1 font-mono">
            {step.stats.added > 0 && <span className="text-success-foreground">+{step.stats.added}</span>}
            {step.stats.added > 0 && step.stats.removed > 0 && " "}
            {step.stats.removed > 0 && <span className="text-destructive">&minus;{step.stats.removed}</span>}
          </span>
        </>
      )}
      {step.stats?.type === "plain" && (
        <>
          {" "}
          <span className="truncate text-muted-foreground/60">{step.stats.label}</span>
        </>
      )}
      {summary && (
        <>
          {" "}
          <span className="truncate text-muted-foreground/60">{summary}</span>
        </>
      )}
      {" "}
      {failed ? (
        <XCircleIcon className="size-3.5 shrink-0 text-destructive" aria-label={`${step.subject} failed`} />
      ) : step.severity === "error" ? (
        <XCircleIcon className="size-3.5 shrink-0 text-destructive" aria-label="Diagnostic error" />
      ) : step.severity === "warning" ? (
        <AlertTriangleIcon className="size-3.5 shrink-0 text-warning-foreground" aria-label="Diagnostic warning" />
      ) : null}
    </>
  );
}
