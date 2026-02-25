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
        "absolute bottom-full -left-px -right-px z-50 max-h-[240px] overflow-y-auto rounded-t-md border border-b-0 bg-background dark:bg-[var(--input-group-bg)] shadow-lg",
        planMode ? "border-dashed border-primary" : "border-border/30",
      )}
      style={{
        "--input-group-bg": "color-mix(in srgb, var(--background), white 3%)",
      } as React.CSSProperties}
    >
      <div className="sticky top-0 bg-black/5 dark:bg-[color-mix(in_srgb,var(--background),white_6%)] px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Files
      </div>
      {items.map((item, i) => {
        const dirPath = item.path.includes("/")
          ? item.path.slice(0, item.path.lastIndexOf("/"))
          : "";
        return (
          <button
            key={item.path}
            ref={i === selectedIndex ? selectedRef : undefined}
            type="button"
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
              i === selectedIndex
                ? "bg-accent text-accent-foreground"
                : "text-foreground hover:bg-accent/50",
            )}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(item);
            }}
            onMouseEnter={() => onHover(i)}
          >
            <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="shrink-0 font-medium">{item.basename}</span>
            {dirPath && (
              <span className="truncate text-xs text-muted-foreground">
                {dirPath}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
