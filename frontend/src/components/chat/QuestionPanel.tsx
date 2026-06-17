import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import type { PendingToolInput } from "@/hooks/useConversation";
import type { Question, QuestionAnswer } from "@/types";
import { cn } from "@/lib/utils";
import { XIcon, ChevronLeftIcon, ChevronRightIcon, ArrowUpIcon } from "lucide-react";

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
  const inputRef = useRef<HTMLInputElement>(null);

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
      // Clicking an option clears custom text
      const isMulti = currentQuestion.question.multiSelect === true;
      if (isMulti) {
        const next = currentDraft.selectedOptions.includes(optionIndex)
          ? currentDraft.selectedOptions.filter((i) => i !== optionIndex)
          : [...currentDraft.selectedOptions, optionIndex];
        updateDraft({ selectedOptions: next, customText: "" });
      } else {
        updateDraft({
          selectedOptions:
            currentDraft.selectedOptions[0] === optionIndex ? [] : [optionIndex],
          customText: "",
        });
      }
    },
    [currentQuestion, currentDraft, updateDraft],
  );

  const handleCustomTextChange = useCallback(
    (value: string) => {
      // Typing in custom input deselects all options
      updateDraft({ customText: value, selectedOptions: [] });
    },
    [updateDraft],
  );

  const hasAnswer = (fq: FlatQuestion): boolean => {
    const d = drafts.get(draftKey(fq));
    if (!d) return false;
    return d.selectedOptions.length > 0 || d.customText.trim().length > 0;
  };

  const answeredCount = flatQuestions.filter(hasAnswer).length;
  const total = flatQuestions.length;
  const canSubmit = total > 1 ? answeredCount === total : answeredCount > 0;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;

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
  }, [canSubmit, flatQuestions, drafts, onBatchSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && canSubmit) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [canSubmit, handleSubmit],
  );

  if (flatQuestions.length === 0) return null;

  return (
    <div className="chat-surface border-t border-border/30 px-3 py-3">
      <div className="rounded-lg border border-border/50 bg-muted/40">
        {/* Question text + dismiss */}
        <div className="flex items-start gap-3 px-4 pt-3.5 pb-1">
          <p className="min-w-0 flex-1 text-[13px] font-medium text-foreground">
            {currentQuestion.question.question}
          </p>
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 rounded p-0.5 text-muted-foreground/50 transition-colors hover:text-foreground"
            aria-label="Dismiss questions"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>

        {/* Options */}
        {currentQuestion.question.options.length > 0 && (
          <div className="space-y-1 px-4 py-2">
            {currentQuestion.question.options.map((opt, i) => {
              const isSelected = currentDraft.selectedOptions.includes(i);
              const description = opt.description?.trim();
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggleOption(i)}
                  className={cn(
                    "block w-full rounded-md border px-2.5 py-2 text-left text-[13px] outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    isSelected
                      ? "border-primary/35 bg-primary/10 text-foreground"
                      : "border-transparent text-foreground/85 hover:border-border/50 hover:bg-muted/35",
                  )}
                >
                  <span className="min-w-0 flex-1 space-y-1">
                    <span
                      className={cn(
                        "block text-[13px] font-medium leading-snug",
                        isSelected ? "text-primary" : "text-foreground",
                      )}
                    >
                      {opt.label}
                    </span>
                    {description && (
                      <span className="block text-[12px] leading-snug text-muted-foreground">
                        {description}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Custom text input + submit */}
        <div className="flex items-center gap-3 px-6 pt-1 pb-3">
          <input
            ref={inputRef}
            type="text"
            placeholder="Type something..."
            value={currentDraft.customText}
            onChange={(e) => handleCustomTextChange(e.target.value)}
            onKeyDown={handleKeyDown}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/40 outline-none"
          />

          {/* Pagination (multi-question only) */}
          {total > 1 && (
            <div className="flex items-center gap-1 mr-1">
              <button
                type="button"
                onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                disabled={currentIndex === 0}
                className="rounded p-0.5 text-muted-foreground/50 transition-colors hover:text-foreground disabled:opacity-0"
                aria-label="Previous question"
              >
                <ChevronLeftIcon className="size-3.5" />
              </button>
              <div className="flex items-center gap-1">
                {flatQuestions.map((fq, i) => (
                  <button
                    key={`${fq.toolUseId}-${fq.questionIndex}`}
                    type="button"
                    onClick={() => setCurrentIndex(i)}
                    className={cn(
                      "size-1.5 rounded-full transition-colors",
                      i === currentIndex
                        ? "bg-foreground"
                        : hasAnswer(fq)
                          ? "bg-foreground/40"
                          : "bg-muted-foreground/20",
                    )}
                    aria-label={`Question ${i + 1}`}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => setCurrentIndex((i) => Math.min(total - 1, i + 1))}
                disabled={currentIndex === total - 1}
                className="rounded p-0.5 text-muted-foreground/50 transition-colors hover:text-foreground disabled:opacity-0"
                aria-label="Next question"
              >
                <ChevronRightIcon className="size-3.5" />
              </button>
            </div>
          )}

          {/* Submit button */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-md transition-colors",
              canSubmit
                ? "bg-foreground text-background hover:bg-foreground/90 cursor-pointer"
                : "bg-muted text-muted-foreground/40 cursor-default",
            )}
            aria-label={total > 1 ? `Submit (${answeredCount}/${total})` : "Submit"}
          >
            <ArrowUpIcon className="size-3.5" strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}
