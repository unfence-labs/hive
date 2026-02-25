import {
  GitPullRequest,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePrStatus } from "@/hooks/usePrStatus";
import { computePrDisplay } from "@/lib/pr-display";

interface PrStatusSectionProps {
  wsId?: string;
}

export function PrStatusSection({ wsId }: PrStatusSectionProps) {
  const { pr, error, loading } = usePrStatus(wsId);

  // Silent loading — show nothing until data arrives
  if (loading) return null;

  // Error state: gh unavailable / not authenticated
  if (error) {
    return (
      <div className="border-t border-border/50 px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs text-destructive">
          <AlertCircle className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">{error}</span>
        </div>
      </div>
    );
  }

  // No PR (non-GitHub repo, or GitHub repo with no PR for this branch)
  if (!pr) {
    return (
      <div className="border-t border-border/50 px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <GitPullRequest className="size-3.5 shrink-0" />
          <span>No pull request</span>
        </div>
      </div>
    );
  }

  const { Icon, iconClass, textClass, label } = computePrDisplay(pr);

  return (
    <div className="border-t border-border/50 px-4 py-2.5">
      <div className="flex items-center gap-2 text-xs">
        <Icon className={cn("size-3.5 shrink-0", iconClass)} />
        <span className={cn("min-w-0 truncate", textClass)}>
          PR #{pr.number} &middot; {label}
        </span>
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="size-3" />
        </a>
      </div>
    </div>
  );
}
