import { useState, useCallback, memo } from "react";
import type { ToolCall, Question, QuestionAnswer } from "@/types";
import { parseQuestions } from "@/types";
import { cn } from "@/lib/utils";
import { MessageResponse } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquareIcon, ClockIcon } from "lucide-react";

interface AskUserQuestionProps {
  tool: ToolCall;
  isInteractive?: boolean;
  onAnswer?: (toolCallId: string, answers: QuestionAnswer[]) => void;
}

export const AskUserQuestion = memo(function AskUserQuestion({
  tool,
  isInteractive = false,
  onAnswer,
}: AskUserQuestionProps) {
  const questions = parseQuestions(tool);

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

  // Read-only historical rendering
  return (
    <div className="my-2 space-y-4">
      {questions.map((q, idx) => (
        <QuestionBlock
          key={idx}
          question={q}
          questionIndex={idx}
          toolCallId={tool.id}
          readOnly
          onAnswer={onAnswer}
        />
      ))}
    </div>
  );
});

interface QuestionBlockProps {
  question: Question;
  questionIndex: number;
  toolCallId: string;
  readOnly: boolean;
  onAnswer?: (toolCallId: string, answers: QuestionAnswer[]) => void;
}

function QuestionBlock({
  question,
  questionIndex,
  toolCallId,
  readOnly,
  onAnswer,
}: QuestionBlockProps) {
  const [selectedOptions, setSelectedOptions] = useState<number[]>([]);
  const [customText, setCustomText] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const isMultiSelect = question.multiSelect === true;
  const hasSelection = selectedOptions.length > 0 || customText.trim().length > 0;

  const handleSubmit = useCallback(() => {
    if (!hasSelection || submitted) return;
    setSubmitted(true);
    onAnswer?.(toolCallId, [
      {
        questionIndex,
        selectedOptions,
        customText: customText.trim() || undefined,
      },
    ]);
  }, [hasSelection, submitted, onAnswer, toolCallId, questionIndex, selectedOptions, customText]);

  const handleRadioChange = (value: string) => {
    setSelectedOptions([parseInt(value, 10)]);
  };

  const handleCheckboxChange = (optionIndex: number, checked: boolean) => {
    setSelectedOptions((prev) =>
      checked ? [...prev, optionIndex] : prev.filter((i) => i !== optionIndex),
    );
  };

  const isDisabled = readOnly || submitted;

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 text-sm font-medium">
        <MessageResponse>{question.question}</MessageResponse>
      </div>

      {question.options.length > 0 && (
        <div className="mb-3">
          {isMultiSelect ? (
            <div className="space-y-2">
              {question.options.map((opt, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Checkbox
                    id={`${toolCallId}-${questionIndex}-${i}`}
                    checked={selectedOptions.includes(i)}
                    onCheckedChange={(checked) =>
                      handleCheckboxChange(i, checked === true)
                    }
                    disabled={isDisabled}
                  />
                  <Label
                    htmlFor={`${toolCallId}-${questionIndex}-${i}`}
                    className={cn(
                      "text-sm font-normal leading-snug",
                      isDisabled && "opacity-60",
                    )}
                  >
                    {opt.label}
                    {opt.description && (
                      <span className="block text-xs text-muted-foreground">
                        {opt.description}
                      </span>
                    )}
                  </Label>
                </div>
              ))}
            </div>
          ) : (
            <RadioGroup
              value={selectedOptions[0]?.toString()}
              onValueChange={handleRadioChange}
              disabled={isDisabled}
            >
              {question.options.map((opt, i) => (
                <div key={i} className="flex items-start gap-2">
                  <RadioGroupItem
                    value={i.toString()}
                    id={`${toolCallId}-${questionIndex}-${i}`}
                  />
                  <Label
                    htmlFor={`${toolCallId}-${questionIndex}-${i}`}
                    className={cn(
                      "text-sm font-normal leading-snug",
                      isDisabled && "opacity-60",
                    )}
                  >
                    {opt.label}
                    {opt.description && (
                      <span className="block text-xs text-muted-foreground">
                        {opt.description}
                      </span>
                    )}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          )}
        </div>
      )}

      {/* Custom text input (always available as "Other") */}
      <div className="mb-3">
        <Textarea
          placeholder="Type a custom response..."
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          disabled={isDisabled}
          className="min-h-[60px] text-sm"
        />
      </div>

      {!isDisabled && (
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!hasSelection}
        >
          Submit
          <Kbd className="ml-2">⌘↵</Kbd>
        </Button>
      )}

      {submitted && (
        <div className="mt-2 text-xs text-muted-foreground italic">
          Answer submitted
        </div>
      )}
    </div>
  );
}
