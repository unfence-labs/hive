import type { AgentActivity, Question, ReasoningSegment, ToolCall } from "@/types";
import { isAskUserQuestion, parseQuestions } from "@/types";
import { cn } from "@/lib/utils";
import type { TimelineStep } from "@/lib/timeline-steps";
import { getToolDisplay, parseContentBlocks, ToolExpandedContent } from "@/lib/tool-display";
import { resolveImageSrc } from "@/lib/image-url";
import { MessageResponse } from "@/components/ai-elements/message";
import { ContentPanel, ContentPanelBody, ContentPanelFooter } from "@/components/chat/ContentPanel";
import { ImageTileWithLightbox } from "@/components/chat/ImageTile";

const OUTSIDE_WORKSPACE_MESSAGE = "Image is outside the workspace and cannot be previewed.";

/**
 * False for steps whose line carries everything there is to show. Plans are
 * false too: their markdown is resolved by the timeline and passed as `detail`.
 */
export function hasStepDetail(step: TimelineStep): boolean {
  if (step.source.type === "reasoning") {
    // The line already shows the latest headline; only open when there is more to read.
    const segments = step.source.segments;
    return segments.some((segment) => segment.body) || segments.filter((segment) => segment.headline).length > 1;
  }
  return step.kind !== "compaction" && step.kind !== "subagent_activity" && step.kind !== "plan";
}

export function StepDetail({ step }: { step: TimelineStep }) {
  switch (step.source.type) {
    case "tool":
      return isAskUserQuestion(step.source.tool)
        ? <QuestionDetail questions={parseQuestions(step.source.tool)} />
        : <ToolDetail tool={step.source.tool} />;
    case "reasoning":
      return <ReasoningDetail segments={step.source.segments} />;
    case "activity":
      return <ActivityDetail activity={step.source.activity} pending={step.status === "running"} />;
    case "text":
      return <TextDetail text={step.source.text} markdown={step.source.markdown} />;
  }
}

function TextDetail({ text, markdown }: { text: string; markdown: boolean }) {
  return (
    <ContentPanel>
      <ContentPanelBody>
        {markdown ? (
          <div className="prose-sm max-h-96 overflow-auto text-muted-foreground">
            <MessageResponse>{text}</MessageResponse>
          </div>
        ) : (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-muted-foreground">{text}</pre>
        )}
      </ContentPanelBody>
    </ContentPanel>
  );
}

export function PlanDetail({ content }: { content: string }) {
  return (
    <ContentPanel>
      <ContentPanelBody className="[&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg">
        <MessageResponse>{content}</MessageResponse>
      </ContentPanelBody>
    </ContentPanel>
  );
}

/** Read-only recap; answers are collected in the QuestionPanel, never inline. */
function QuestionDetail({ questions }: { questions: Question[] }) {
  return (
    <ContentPanel>
      <ContentPanelBody>
        {questions.map((question, index) => (
          <div key={index} className={cn(index > 0 && "mt-3 border-t border-border/30 pt-3")}>
            <div className="mb-1 text-xs font-medium text-foreground/80">{question.question}</div>
            {question.options.length > 0 && (
              <div className="space-y-0.5">
                {question.options.map((option, optionIndex) => (
                  <div key={optionIndex} className="flex items-baseline gap-2 text-xs text-muted-foreground">
                    <span className="shrink-0 font-mono">{optionIndex + 1}.</span>
                    <span>
                      {option.label}
                      {option.description && (
                        <span className="ml-1 text-muted-foreground/60"> · {option.description}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </ContentPanelBody>
    </ContentPanel>
  );
}

function ToolDetail({ tool }: { tool: ToolCall }) {
  const display = getToolDisplay(tool);
  const taskOutputText = tool.name === "Task" && tool.output ? parseContentBlocks(tool.output) : null;

  return (
    <ContentPanel>
      <ContentPanelBody>
        <ToolExpandedContent content={display.expandedContent} />
      </ContentPanelBody>
      {tool.output !== undefined && !display.hideOutput && (
        <ContentPanelFooter>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50">Output</div>
          {taskOutputText ? (
            <div className="prose-sm max-h-96 overflow-auto text-muted-foreground">
              <MessageResponse>{taskOutputText}</MessageResponse>
            </div>
          ) : (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-muted-foreground">
              {typeof tool.output === "string" ? tool.output : JSON.stringify(tool.output, null, 2)}
            </pre>
          )}
        </ContentPanelFooter>
      )}
    </ContentPanel>
  );
}

function ReasoningDetail({ segments }: { segments: ReasoningSegment[] }) {
  return (
    <ContentPanel>
      <ContentPanelBody className="font-mono text-[11px] leading-normal">
        {segments.filter((thought) => thought.headline || thought.body).map((thought) => (
          <div key={thought.id} className="flex gap-2 py-0.5">
            <span aria-hidden="true" className="shrink-0 select-none text-muted-foreground/70">·</span>
            <span className="min-w-0">
              {thought.headline && <span className="text-foreground">{thought.headline}</span>}
              {thought.headline && thought.body && <span className="text-muted-foreground"> · </span>}
              {thought.body && <span className="text-muted-foreground">{thought.body}</span>}
            </span>
          </div>
        ))}
      </ContentPanelBody>
    </ContentPanel>
  );
}

function ActivityDetail({ activity, pending }: { activity: AgentActivity; pending: boolean }) {
  switch (activity.kind) {
    case "diagnostic":
      return (
        <ContentPanel>
          <ContentPanelBody>
            <ToolExpandedContent content={[activity.message, activity.details].filter(Boolean).join("\n\n")} />
          </ContentPanelBody>
        </ContentPanel>
      );
    case "image_view":
      return (
        <ContentPanel>
          <ContentPanelBody>
            <ImageTileWithLightbox
              src={activity.imageUrl ? resolveImageSrc(activity.imageUrl) : undefined}
              alt={activity.path.split("/").pop() || activity.path}
              noPreviewMessage={activity.outsideWorkspace ? OUTSIDE_WORKSPACE_MESSAGE : undefined}
              className="size-20"
            />
          </ContentPanelBody>
        </ContentPanel>
      );
    case "image_generation":
      return (
        <ContentPanel>
          <ContentPanelBody className="space-y-2">
            <ImageTileWithLightbox
              src={imageGenerationSrc(activity)}
              alt={activity.revisedPrompt ?? "Generated image"}
              pending={pending}
              className="size-20"
            />
            {activity.revisedPrompt && (
              <p className="whitespace-pre-wrap text-muted-foreground">{activity.revisedPrompt}</p>
            )}
          </ContentPanelBody>
        </ContentPanel>
      );
    default:
      return null;
  }
}

/** Prefer the workspace raw-file URL, fall back to the inline base64 result. */
function imageGenerationSrc(activity: Extract<AgentActivity, { kind: "image_generation" }>): string | undefined {
  if (activity.imageUrl) return resolveImageSrc(activity.imageUrl);
  if (!activity.result) return undefined;
  return activity.result.startsWith("data:") ? activity.result : `data:image/png;base64,${activity.result}`;
}
