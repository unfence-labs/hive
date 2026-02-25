import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatTokenCount, formatCostUsd, usageStrokeColor } from "@/lib/format-usage";
import type { ContextUsageData } from "@/hooks/useContextUsage";

interface ContextRingProps {
  usage: ContextUsageData;
}

const SIZE = 16;
const STROKE_WIDTH = 2;
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ContextRing({ usage }: ContextRingProps) {
  const { usageFraction, inputTokens, contextWindow, sessionCostUsd } = usage;

  // Nothing to show before first turn completes
  if (usageFraction === null && sessionCostUsd === null) return null;

  const fraction = usageFraction ?? 0;
  const dashOffset = CIRCUMFERENCE * (1 - fraction);
  const strokeColor = usageStrokeColor(fraction);
  const percentage = Math.round(fraction * 100);

  const tokensPart =
    inputTokens != null && contextWindow != null
      ? `${formatTokenCount(inputTokens)} / ${formatTokenCount(contextWindow)} tokens`
      : null;
  const percentPart = usageFraction != null ? `${percentage}%` : null;
  const costPart =
    sessionCostUsd != null ? `${formatCostUsd(sessionCostUsd)} session total` : null;
  const tooltipText = [tokensPart, percentPart, costPart].filter(Boolean).join(" \u00b7 ");

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex cursor-default items-center gap-1">
            {usageFraction !== null && (
              <svg
                width={SIZE}
                height={SIZE}
                viewBox={`0 0 ${SIZE} ${SIZE}`}
                className="-rotate-90 shrink-0"
              >
                <circle
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={RADIUS}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={STROKE_WIDTH}
                  className="text-muted-foreground/20"
                />
                <circle
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={RADIUS}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={STROKE_WIDTH}
                  strokeLinecap="round"
                  strokeDasharray={CIRCUMFERENCE}
                  strokeDashoffset={dashOffset}
                  style={{
                    transition: "stroke-dashoffset 0.3s ease, stroke 0.3s ease",
                  }}
                />
              </svg>
            )}
            {sessionCostUsd !== null && (
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {formatCostUsd(sessionCostUsd)}
              </span>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltipText}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
