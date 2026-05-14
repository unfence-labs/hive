import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useServerMetrics } from "@/hooks/useServerMetrics";
import { usageStrokeColor } from "@/lib/format-usage";

interface MetricBarProps {
  label: string;
  percent: number;
}

function MetricBar({ label, percent }: MetricBarProps) {
  const color = usageStrokeColor(percent / 100);
  return (
    <div className="flex flex-1 items-center gap-1">
      <span className="shrink-0 text-[10px] font-medium text-muted-foreground">
        {label}
      </span>
      <div className="h-1 flex-1 rounded-full bg-border dark:bg-muted/40">
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${percent}%`, backgroundColor: color }}
        />
      </div>
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
          <div className="flex items-center gap-2.5 cursor-default">
            <MetricBar label="CPU" percent={metrics.cpuPercent} />
            <MetricBar label="MEM" percent={metrics.memPercent} />
            <MetricBar label="DSK" percent={metrics.diskPercent} />
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
