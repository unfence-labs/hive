import { GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";

interface BranchLabelProps {
  branch: string;
  className?: string;
  showIcon?: boolean;
}

export function BranchLabel({
  branch,
  className,
  showIcon = true,
}: BranchLabelProps) {
  return (
    <span className={cn("flex items-center gap-1.5", className)}>
      {showIcon && (
        <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 truncate">{branch}</span>
    </span>
  );
}
