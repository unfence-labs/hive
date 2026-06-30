import type { KeyboardEvent, RefObject } from "react";
import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import { useStickToBottomContext } from "use-stick-to-bottom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConversationFind } from "@/hooks/useConversationFind";
import { cn } from "@/lib/utils";

/**
 * Floating "find in conversation" (Cmd/Ctrl+F) bar. All matching, navigation,
 * and highlight painting lives in `useConversationFind`; this component is the
 * presentational shell wired to that hook.
 */
export function ConversationFind({ switchCounter }: { switchCounter: number }) {
  const { scrollRef } = useStickToBottomContext();
  const { open, query, matchCount, activeIndex, inputRef, setQuery, next, prev, close } =
    useConversationFind({
      scrollRef: scrollRef as RefObject<HTMLElement | null>,
      switchCounter,
    });

  if (!open) return null;

  const noResults = matchCount === 0 && query !== "";
  const counter = matchCount === 0 ? "0/0" : `${activeIndex + 1}/${matchCount}`;

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) prev();
      else next();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  return (
    <div
      role="search"
      className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-md border bg-popover p-1 shadow-md"
    >
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Find in conversation"
        aria-invalid={noResults}
        className="h-7 w-48 text-sm"
      />
      <span
        className={cn(
          "min-w-10 shrink-0 text-center text-xs tabular-nums",
          noResults ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {counter}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        title="Previous match"
        aria-label="Previous match"
        disabled={matchCount === 0}
        onClick={prev}
      >
        <ChevronUpIcon className="size-3" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        title="Next match"
        aria-label="Next match"
        disabled={matchCount === 0}
        onClick={next}
      >
        <ChevronDownIcon className="size-3" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        title="Close find"
        aria-label="Close find"
        onClick={close}
      >
        <XIcon className="size-3" />
      </Button>
    </div>
  );
}
