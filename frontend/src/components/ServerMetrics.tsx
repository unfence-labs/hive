import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useServerMetrics } from "@/hooks/useServerMetrics";
import { usageStrokeColor } from "@/lib/format-usage";

interface MetricDotProps {
  label: string;
  percent: number;
}

function MetricDot({ label, percent }: MetricDotProps) {
  const color = usageStrokeColor(percent / 100);
  return (
    <div className="flex items-center gap-1">
      <div
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="text-[10px] leading-none text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

export function ServerMetrics() {
  const metrics = useServerMetrics();

  if (!metrics) return null;

  const tooltip = [
    `CPU ${metrics.cpuPercent}%`,
    `Memory ${metrics.memPercent}%`,
    `Disk ${metrics.diskPercent}%`,
  ].join(" · ");

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2 px-1 cursor-default">
            <MetricDot label="CPU" percent={metrics.cpuPercent} />
            <MetricDot label="MEM" percent={metrics.memPercent} />
            <MetricDot label="DSK" percent={metrics.diskPercent} />
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
