import { useMemo, useState } from "react";
import { XCircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { findLiveDescendant, liveLabel, type TimelineStep } from "@/lib/timeline-steps";
import { parseSubAgentInfo } from "@/lib/sub-agent";
import { parseContentBlocks } from "@/lib/tool-display";
import { useCoalescedValue } from "@/hooks/useCoalescedValue";
import { StepIconGlyph } from "@/components/chat/StepIcon";
import { STEP_LINE_CLASS, STEP_LIST_CLASS, StepRow } from "@/components/chat/StepRow";

const LIVE_LABEL_WINDOW_MS = 200;

interface StepItemProps {
  step: TimelineStep;
}

/** Agents indent under a rail and recurse; every other step is a plain row. */
export function StepItem({ step }: StepItemProps) {
  return step.kind === "agent" ? <AgentStep step={step} /> : <StepRow step={step} />;
}

export function AgentStep({ step }: StepItemProps) {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const tool = step.source.type === "tool" ? step.source.tool : undefined;
  const info = tool ? parseSubAgentInfo(tool) : null;
  const children = step.children ?? [];
  const running = step.status === "running";
  const failed = step.status === "failed";
  const liveChild = running ? findLiveDescendant(children) : undefined;
  const live = useCoalescedValue(liveChild ? liveLabel(liveChild) : "", LIVE_LABEL_WINDOW_MS);
  const finished = step.status === "completed" || failed;
  const resultStep = useMemo(
    () => (finished && tool?.output ? textStep(`${step.id}:result`, "result", failed ? "Failure" : "Result", tool.output) : undefined),
    [finished, failed, step.id, tool?.output],
  );

  if (!tool || !info) return <StepRow step={step} />;

  return (
    <div>
      <button
        type="button"
        className={cn(STEP_LINE_CLASS, "cursor-pointer hover:bg-muted/60 hover:text-foreground")}
        title={step.subjectTitle}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setOpened(true);
        }}
      >
        <StepIconGlyph
          icon="bot"
          className={cn("size-3.5 shrink-0", failed ? "text-destructive" : "text-muted-foreground")}
        />
        <span className="shrink-0 font-mono">{info.subagentType}</span>
        {info.description && (
          <>
            {" "}
            <span className="truncate">{info.description}</span>
          </>
        )}
        {live && (
          <>
            {" · "}
            <span className="truncate step-live-text">{live}</span>
          </>
        )}
        {children.length > 0 && (
          <>
            {" · "}
            <span className="shrink-0 text-muted-foreground/60">{children.length} tool{children.length === 1 ? "" : "s"}</span>
          </>
        )}
        {failed && (
          <XCircleIcon className="size-3.5 shrink-0 text-destructive" aria-label={`${step.subject} failed`} />
        )}
      </button>
      {opened && (
        <div hidden={!open} className={cn(STEP_LIST_CLASS, "pl-5")}>
          {info.prompt && <StepRow step={textStep(`${step.id}:prompt`, "prompt", "Prompt", info.prompt)} />}
          {children.map((child) => <StepItem key={child.id} step={child} />)}
          {resultStep && <StepRow step={resultStep} />}
        </div>
      )}
    </div>
  );
}


/** Synthetic Prompt / Result lines; never part of the view-model rows or run counts. */
function textStep(id: string, kind: "prompt" | "result", subject: string, output: string): TimelineStep {
  // Some providers hand back structured output despite the string type; never feed an object to React.
  const raw = typeof output === "string" ? output : JSON.stringify(output, null, 2);
  const markdown = kind === "result" ? parseContentBlocks(raw) : null;
  return {
    id,
    kind,
    icon: kind,
    liveVerb: "",
    verb: "",
    subject,
    status: "completed",
    standalone: true,
    source: { type: "text", text: markdown ?? raw, markdown: markdown !== null },
  };
}
