import { useState, useMemo, useCallback, useEffect } from "react";
import type { PendingToolInput } from "@/hooks/useConversation";
import type { Question, QuestionAnswer } from "@/types";
import { MessageResponse } from "@/components/ai-elements/message";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { XIcon, ChevronLeftIcon, ChevronRightIcon, SendIcon, ArrowRightIcon } from "lucide-react";

interface QuestionPanelProps {
  pendingToolInputs: PendingToolInput[];
  onBatchSubmit: (
    responses: Array<{ toolUseId: string; answers: QuestionAnswer[] }>,
  ) => void;
  onDismiss: () => void;
}

/** A flattened question with its origin tool call info. */
interface FlatQuestion {
  toolUseId: string;
  questionIndex: number;
  question: Question;
}

function flattenQuestions(inputs: PendingToolInput[]): FlatQuestion[] {
  const result: FlatQuestion[] = [];
  for (const p of inputs) {
    if (p.toolName !== "AskUserQuestion") continue;
    const parsed = p.input as { questions?: Question[] } | undefined;
    const questions = parsed?.questions ?? [];
    for (let i = 0; i < questions.length; i++) {
      result.push({ toolUseId: p.toolUseId, questionIndex: i, question: questions[i] });
    }
  }
  return result;
}

/** Per-question local answer state. */
interface AnswerDraft {
  selectedOptions: number[];
  customText: string;
}

const emptyDraft = (): AnswerDraft => ({ selectedOptions: [], customText: "" });

export default function QuestionPanel({
  pendingToolInputs,
  onBatchSubmit,
  onDismiss,
}: QuestionPanelProps) {
  const flatQuestions = useMemo(
    () => flattenQuestions(pendingToolInputs),
    [pendingToolInputs],
  );

  const [currentIndex, setCurrentIndex] = useState(0);
  const [drafts, setDrafts] = useState<Map<string, AnswerDraft>>(new Map());

  // Clamp index if questions change
  useEffect(() => {
    if (currentIndex >= flatQuestions.length && flatQuestions.length > 0) {
      setCurrentIndex(flatQuestions.length - 1);
    }
  }, [flatQuestions.length, currentIndex]);

  const draftKey = (fq: FlatQuestion) => `${fq.toolUseId}-${fq.questionIndex}`;

  const currentQuestion = flatQuestions[currentIndex];
  const currentDraft =
    currentQuestion ? (drafts.get(draftKey(currentQuestion)) ?? emptyDraft()) : emptyDraft();

  const updateDraft = useCallback(
    (patch: Partial<AnswerDraft>) => {
      if (!currentQuestion) return;
      const key = draftKey(currentQuestion);
      setDrafts((prev) => {
        const next = new Map(prev);
        const existing = prev.get(key) ?? emptyDraft();
        next.set(key, { ...existing, ...patch });
        return next;
      });
    },
    [currentQuestion],
  );

  const toggleOption = useCallback(
    (optionIndex: number) => {
      if (!currentQuestion) return;
      const isMulti = currentQuestion.question.multiSelect === true;
      if (isMulti) {
        const next = currentDraft.selectedOptions.includes(optionIndex)
          ? currentDraft.selectedOptions.filter((i) => i !== optionIndex)
          : [...currentDraft.selectedOptions, optionIndex];
        updateDraft({ selectedOptions: next });
      } else {
        updateDraft({
          selectedOptions:
            currentDraft.selectedOptions[0] === optionIndex ? [] : [optionIndex],
        });
      }
    },
    [currentQuestion, currentDraft, updateDraft],
  );

  const hasAnswer = (fq: FlatQuestion): boolean => {
    const d = drafts.get(draftKey(fq));
    if (!d) return false;
    return d.selectedOptions.length > 0 || d.customText.trim().length > 0;
  };

  const answeredCount = flatQuestions.filter(hasAnswer).length;

  const handleSubmit = useCallback(() => {
    // Group answers by toolUseId
    const grouped = new Map<string, QuestionAnswer[]>();
    for (const fq of flatQuestions) {
      const d = drafts.get(draftKey(fq));
      if (!d || (d.selectedOptions.length === 0 && !d.customText.trim())) continue;
      if (!grouped.has(fq.toolUseId)) grouped.set(fq.toolUseId, []);
      grouped.get(fq.toolUseId)!.push({
        questionIndex: fq.questionIndex,
        selectedOptions: d.selectedOptions,
        customText: d.customText.trim() || undefined,
      });
    }
    const responses = Array.from(grouped.entries()).map(([toolUseId, answers]) => ({
      toolUseId,
      answers,
    }));
    onBatchSubmit(responses);
  }, [flatQuestions, drafts, onBatchSubmit]);

  if (flatQuestions.length === 0) return null;

  const total = flatQuestions.length;

  return (
    <div className="border-t border-border/30 bg-background p-4">
      {/* Header: question text + dismiss */}
      <div className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1 text-sm font-medium">
          <MessageResponse>{currentQuestion.question.question}</MessageResponse>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Dismiss questions"
        >
          <XIcon className="size-4" />
        </button>
      </div>

      {/* Numbered options */}
      {currentQuestion.question.options.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {currentQuestion.question.options.map((opt, i) => {
            const isSelected = currentDraft.selectedOptions.includes(i);
            return (
              <button
                key={i}
                type="button"
                onClick={() => toggleOption(i)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                  isSelected
                    ? "bg-primary/10 text-primary ring-1 ring-primary/20"
                    : "text-foreground hover:bg-muted/50",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded text-xs font-medium",
                    isSelected
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  {opt.label}
                  {opt.description && (
                    <span className="block text-xs text-muted-foreground">
                      {opt.description}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Custom text (the "0" row) */}
      <div className="mb-3 flex items-start gap-3">
        <span className="mt-2 flex size-5 shrink-0 items-center justify-center rounded bg-muted text-xs font-medium text-muted-foreground">
          0
        </span>
        <Textarea
          placeholder="Type something..."
          value={currentDraft.customText}
          onChange={(e) => updateDraft({ customText: e.target.value })}
          className="min-h-[40px] flex-1 text-sm"
          rows={1}
        />
      </div>

      {/* Footer: pagination + submit */}
      <div className="flex items-center justify-between">
        {/* Pagination */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
            disabled={currentIndex === 0}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
            aria-label="Previous question"
          >
            <ChevronLeftIcon className="size-4" />
          </button>

          {/* Dots */}
          <div className="flex items-center gap-1.5">
            {flatQuestions.map((fq, i) => (
              <button
                key={`${fq.toolUseId}-${fq.questionIndex}`}
                type="button"
                onClick={() => setCurrentIndex(i)}
                className={cn(
                  "size-2 rounded-full transition-colors",
                  i === currentIndex
                    ? "bg-foreground"
                    : hasAnswer(fq)
                      ? "bg-primary/60"
                      : "bg-muted-foreground/30",
                )}
                aria-label={`Question ${i + 1}`}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => setCurrentIndex((i) => Math.min(total - 1, i + 1))}
            disabled={currentIndex === total - 1}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
            aria-label="Next question"
          >
            <ChevronRightIcon className="size-4" />
          </button>
        </div>

        {/* Next / Submit */}
        {currentIndex < total - 1 ? (
          <Button
            size="sm"
            onClick={() => setCurrentIndex((i) => i + 1)}
            className="gap-1.5"
          >
            Next
            <ArrowRightIcon className="size-3" />
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={answeredCount === 0}
            className="gap-1.5"
          >
            <SendIcon className="size-3" />
            Submit{total > 1 ? ` (${answeredCount}/${total})` : ""}
          </Button>
        )}
      </div>
    </div>
  );
}
