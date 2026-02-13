import { useState, memo } from "react";
import type { ToolCall } from "@/types";
import { parseQuestions } from "@/types";
import { cn } from "@/lib/utils";
import { MessageSquareIcon, ClockIcon, CheckCircle2Icon, ChevronRightIcon } from "lucide-react";

interface AskUserQuestionProps {
  tool: ToolCall;
  isInteractive?: boolean;
}

export const AskUserQuestion = memo(function AskUserQuestion({
  tool,
  isInteractive = false,
}: AskUserQuestionProps) {
  const questions = parseQuestions(tool);
  const [expanded, setExpanded] = useState(false);

  if (questions.length === 0) return null;

  // When interactive, questions are handled by QuestionPanel at the bottom.
  // Show a compact inline indicator instead of the full form.
  if (isInteractive) {
    return (
      <div className="my-2 flex items-center gap-2 rounded-lg border border-border/50 px-3 py-2">
        <MessageSquareIcon className="size-3.5 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">User input</span>
        <span className="ml-auto inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-[11px] font-mono text-muted-foreground">
          <ClockIcon className="size-3" />
          AWAITING RESPONSE
        </span>
      </div>
    );
  }

  // Read-only historical rendering — collapsible like other tools
  return (
    <div className="my-0.5">
      <button
        type="button"
        className="inline-flex w-fit items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRightIcon
          className={cn(
            "size-3.5 transition-transform",
            expanded && "rotate-90",
          )}
        />
        <MessageSquareIcon className="size-3.5" />
        <span>User input</span>
        <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-[11px] font-mono text-muted-foreground">
          <CheckCircle2Icon className="size-3" />
          ANSWERED
        </span>
        {!expanded && (
          <span className="text-xs font-normal text-muted-foreground/60">
            {questions.length} question{questions.length !== 1 ? "s" : ""}
          </span>
        )}
      </button>
      {expanded && (
        <div className="mt-1 rounded bg-muted/40 px-3 py-2 text-sm">
          {questions.map((q, idx) => (
            <div key={idx} className={cn(idx > 0 && "mt-3 border-t border-border/30 pt-3")}>
              <div className="mb-1 font-medium text-foreground/80">{q.question}</div>
              {q.options.length > 0 && (
                <div className="space-y-0.5">
                  {q.options.map((opt, i) => (
                    <div key={i} className="flex items-baseline gap-2 text-xs text-muted-foreground">
                      <span className="shrink-0 font-mono">{i + 1}.</span>
                      <span>
                        {opt.label}
                        {opt.description && (
                          <span className="ml-1 text-muted-foreground/60">— {opt.description}</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
