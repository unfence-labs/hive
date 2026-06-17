import { useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { FileIcon } from "lucide-react";
import type { FuzzyResult } from "@/lib/fuzzy-match";

interface FileAutocompletePopupProps {
  items: FuzzyResult[];
  selectedIndex: number;
  onSelect: (item: FuzzyResult) => void;
  onHover: (index: number) => void;
  planMode?: boolean;
}

export function FileAutocompletePopup({
  items,
  selectedIndex,
  onSelect,
  onHover,
  planMode,
}: FileAutocompletePopupProps) {
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (items.length === 0) return null;

  return (
    <div
      className={cn(
        "absolute bottom-full -left-px -right-px z-50 max-h-[240px] overflow-y-auto rounded-t-md border border-b-0 bg-popover text-popover-foreground shadow-lg",
        planMode ? "border-dashed border-primary" : "border-border/30",
      )}
    >
      <div className="sticky top-0 bg-muted/70 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Files
      </div>
      <div className="p-1">
      {items.map((item, i) => {
        const dirPath = item.path.includes("/")
          ? item.path.slice(0, item.path.lastIndexOf("/"))
          : "";
        const isSelected = i === selectedIndex;
        return (
          <button
            key={item.path}
            ref={isSelected ? selectedRef : undefined}
            type="button"
            className={cn(
              "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors",
              isSelected
                ? "bg-primary/10 text-primary"
                : "text-foreground hover:bg-accent hover:text-accent-foreground",
            )}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(item);
            }}
            onMouseEnter={() => onHover(i)}
          >
            <FileIcon className={cn("size-3.5 shrink-0", isSelected ? "text-primary/60" : "text-muted-foreground")} />
            <span className="shrink-0 font-medium">{item.basename}</span>
            {dirPath && (
              <span className={cn("truncate text-xs", isSelected ? "text-primary/60" : "text-muted-foreground")}>
                {dirPath}
              </span>
            )}
          </button>
        );
      })}
      </div>
    </div>
  );
}
