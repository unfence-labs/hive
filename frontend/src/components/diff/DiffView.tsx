import { memo, useMemo } from "react";
import { diffLines } from "diff";
import { cn } from "@/lib/utils";

interface DiffViewProps {
  oldText: string;
  newText: string;
  unifiedDiff?: string;
  filePath?: string;
  className?: string;
  scrollClassName?: string;
}

function linePrefix(part: { added?: boolean; removed?: boolean }): string {
  if (part.added) return "+";
  if (part.removed) return "-";
  return " ";
}

export const DiffView = memo(function DiffView({
  oldText,
  newText,
  unifiedDiff,
  filePath,
  className,
  scrollClassName,
}: DiffViewProps) {
  const parts = useMemo(() => diffLines(oldText, newText), [oldText, newText]);
  const unifiedLines = useMemo(() => unifiedDiff?.replace(/\n$/, "").split("\n") ?? [], [unifiedDiff]);

  return (
    <div className={className}>
      {filePath && (
        <div className="mb-1.5 text-muted-foreground">Path: {filePath}</div>
      )}
      <div className={cn("overflow-auto rounded border border-border/30", scrollClassName ?? "max-h-64")}>
        {unifiedDiff ? unifiedLines.map((line, i) => (
          <div
            key={i}
            className={cn(
              "px-2 font-mono",
              line.startsWith("+") && !line.startsWith("+++") && "bg-success-muted text-success-foreground",
              line.startsWith("-") && !line.startsWith("---") && "bg-destructive/10 text-destructive",
              line.startsWith("@@") && "bg-muted/60 text-muted-foreground",
            )}
          >
            {line}
          </div>
        )) : parts.map((part, i) => {
          const lines = part.value.replace(/\n$/, "").split("\n");
          return lines.map((line, j) => (
            <div
              key={`${i}-${j}`}
              className={cn(
                "px-2 font-mono",
                part.added && "bg-success-muted text-success-foreground",
                part.removed && "bg-destructive/10 text-destructive",
              )}
            >
              <span className="inline-block w-4 select-none opacity-60">
                {linePrefix(part)}
              </span>
              {line}
            </div>
          ));
        })}
      </div>
    </div>
  );
});
