import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatTokenCount, usageStrokeColor } from "@/lib/format-usage";
import type { ContextUsageData } from "@/hooks/useContextUsage";

interface ContextRingProps {
  usage: ContextUsageData;
}

const SIZE = 16;
const STROKE_WIDTH = 2;
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ContextRing({ usage }: ContextRingProps) {
  const { usageFraction, inputTokens, contextWindow } = usage;

  if (usageFraction === null) return null;

  const dashOffset = CIRCUMFERENCE * (1 - usageFraction);
  const strokeColor = usageStrokeColor(usageFraction);
  const percentage = Math.round(usageFraction * 100);

  const tokensPart =
    inputTokens != null && contextWindow != null
      ? `${formatTokenCount(inputTokens)} / ${formatTokenCount(contextWindow)} tokens`
      : null;
  const percentPart = `${percentage}%`;
  const tooltipText = [tokensPart, percentPart].filter(Boolean).join(" \u00b7 ");

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <svg
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="-rotate-90 shrink-0 cursor-default"
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
        </TooltipTrigger>
        <TooltipContent side="top">{tooltipText}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
