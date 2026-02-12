import { memo, useMemo } from "react";
import { diffLines } from "diff";
import { cn } from "@/lib/utils";

interface DiffViewProps {
  oldText: string;
  newText: string;
  filePath?: string;
  className?: string;
}

export const DiffView = memo(function DiffView({
  oldText,
  newText,
  filePath,
  className,
}: DiffViewProps) {
  const parts = useMemo(() => diffLines(oldText, newText), [oldText, newText]);

  return (
    <div className={className}>
      {filePath && (
        <div className="mb-1.5 text-muted-foreground">Path: {filePath}</div>
      )}
      <div className="max-h-64 overflow-auto rounded border border-border/30">
        {parts.map((part, i) => {
          const lines = part.value.replace(/\n$/, "").split("\n");
          return lines.map((line, j) => (
            <div
              key={`${i}-${j}`}
              className={cn(
                "px-2 font-mono",
                part.added && "bg-green-500/15 text-green-400",
                part.removed && "bg-red-500/15 text-red-400",
              )}
            >
              <span className="inline-block w-4 select-none opacity-60">
                {part.added ? "+" : part.removed ? "-" : " "}
              </span>
              {line}
            </div>
          ));
        })}
      </div>
    </div>
  );
});
