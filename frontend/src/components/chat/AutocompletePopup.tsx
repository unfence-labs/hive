import { useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { COMPLETION_SOURCE_ORDER } from "@/lib/completion";
import type { CompletionItem, CompletionSource } from "@/types";

interface AutocompletePopupProps {
  items: CompletionItem[];
  selectedIndex: number;
  onSelect: (item: CompletionItem) => void;
  onHover: (index: number) => void;
  planMode?: boolean;
}

export function AutocompletePopup({
  items,
  selectedIndex,
  onSelect,
  onHover,
  planMode,
}: AutocompletePopupProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (items.length === 0) return null;

  // Group items by source in display order
  const grouped: { source: CompletionSource; items: { item: CompletionItem; globalIndex: number }[] }[] = [];

  for (const source of COMPLETION_SOURCE_ORDER) {
    const sourceItems = items
      .map((item, i) => ({ item, globalIndex: i }))
      .filter(({ item }) => item.source === source);
    if (sourceItems.length > 0) {
      grouped.push({ source, items: sourceItems });
    }
  }

  // If grouping missed any items (unknown sources), append them
  const knownSources = new Set(COMPLETION_SOURCE_ORDER);
  const ungrouped = items
    .map((item, i) => ({ item, globalIndex: i }))
    .filter(({ item }) => !knownSources.has(item.source));
  if (ungrouped.length > 0) {
    grouped.push({ source: ungrouped[0].item.source, items: ungrouped });
  }

  return (
    <div
      ref={listRef}
      className={cn(
        "absolute bottom-full left-0 right-0 mb-2 z-50 max-h-[240px] overflow-y-auto rounded-md border bg-field text-popover-foreground",
        planMode ? "border-dashed border-primary" : "border-border/30",
      )}
    >
      {grouped.map(({ source, items: groupItems }) => (
        <div key={source}>
          <div className="p-1">
          {groupItems.map(({ item, globalIndex }) => (
            <button
              key={`${item.source}-${item.name}`}
              ref={globalIndex === selectedIndex ? selectedRef : undefined}
              type="button"
              className={cn(
                "flex w-full items-baseline gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors",
                globalIndex === selectedIndex
                  ? "bg-primary/10 text-primary"
                  : "text-foreground hover:bg-accent hover:text-accent-foreground",
              )}
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent textarea blur
                onSelect(item);
              }}
              onMouseEnter={() => onHover(globalIndex)}
            >
              <span className="shrink-0 font-medium">{item.label}</span>
              {item.argumentHint && (
                <span className={cn(
                  "shrink-0 font-mono text-xs",
                  globalIndex === selectedIndex ? "text-primary/50" : "text-muted-foreground/70",
                )}>
                  {item.argumentHint}
                </span>
              )}
              {item.description && (
                <span className={cn(
                  "truncate text-xs",
                  globalIndex === selectedIndex ? "text-primary/60" : "text-muted-foreground",
                )}>
                  {item.description}
                </span>
              )}
            </button>
          ))}
          </div>
        </div>
      ))}
    </div>
  );
}
