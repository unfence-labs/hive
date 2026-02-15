import { useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { CompletionItem, CompletionSource } from "@/types";

const SOURCE_LABELS: Record<CompletionSource, string> = {
  builtin: "Commands",
  user_skill: "Skills",
  project_skill: "Project Skills",
  plugin: "Plugin Commands",
  user_agent: "Agents",
  project_agent: "Project Agents",
};

const SOURCE_ORDER: CompletionSource[] = [
  "builtin",
  "user_skill",
  "project_skill",
  "plugin",
  "user_agent",
  "project_agent",
];

interface AutocompletePopupProps {
  items: CompletionItem[];
  selectedIndex: number;
  onSelect: (item: CompletionItem) => void;
  onHover: (index: number) => void;
}

export function AutocompletePopup({
  items,
  selectedIndex,
  onSelect,
  onHover,
}: AutocompletePopupProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (items.length === 0) return null;

  // Group items by source in display order
  const grouped: { source: CompletionSource; items: { item: CompletionItem; globalIndex: number }[] }[] = [];

  for (const source of SOURCE_ORDER) {
    const sourceItems = items
      .map((item, i) => ({ item, globalIndex: i }))
      .filter(({ item }) => item.source === source);
    if (sourceItems.length > 0) {
      grouped.push({ source, items: sourceItems });
    }
  }

  // If grouping missed any items (unknown sources), append them
  const knownSources = new Set(SOURCE_ORDER);
  const ungrouped = items
    .map((item, i) => ({ item, globalIndex: i }))
    .filter(({ item }) => !knownSources.has(item.source));
  if (ungrouped.length > 0) {
    grouped.push({ source: ungrouped[0].item.source, items: ungrouped });
  }

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-[240px] overflow-y-auto rounded-lg border border-border/50 bg-popover shadow-lg"
    >
      {grouped.map(({ source, items: groupItems }) => (
        <div key={source}>
          {grouped.length > 1 && (
            <div className="sticky top-0 bg-popover/95 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground backdrop-blur-sm">
              {SOURCE_LABELS[source] ?? source}
            </div>
          )}
          {groupItems.map(({ item, globalIndex }) => (
            <button
              key={`${item.source}-${item.name}`}
              ref={globalIndex === selectedIndex ? selectedRef : undefined}
              type="button"
              className={cn(
                "flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm transition-colors",
                globalIndex === selectedIndex
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground hover:bg-accent/50",
              )}
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent textarea blur
                onSelect(item);
              }}
              onMouseEnter={() => onHover(globalIndex)}
            >
              <span className="shrink-0 font-medium">{item.label}</span>
              {item.description && (
                <span className="truncate text-xs text-muted-foreground">
                  {item.description}
                </span>
              )}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
