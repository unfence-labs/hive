import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useProviderUsage, type ProviderUsageBucket, type ProviderUsageEntry } from "@/hooks/useProviderUsage";
import { usageStrokeColor } from "@/lib/format-usage";
import { cn } from "@/lib/utils";

interface ProviderUsageSummary {
  provider: ProviderUsageEntry;
  bucket: ProviderUsageBucket | null;
  percent: number | null;
}

export function ProviderUsage() {
  const { data } = useProviderUsage();
  const summaries = (data?.providers ?? [])
    .filter((provider) => provider.status !== "unavailable")
    .map((provider) => {
      const bucket = pickPrimaryBucket(provider.buckets);
      return {
        provider,
        bucket,
        percent: bucket?.usedPercent ?? null,
      };
    });

  if (summaries.length === 0) return null;

  const tooltip = summaries.map(formatTooltipLine).join("\n");

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex cursor-default items-center gap-2 overflow-hidden">
            {summaries.map((summary) => (
              <ProviderUsageRow
                key={summary.provider.id}
                summary={summary}
              />
            ))}
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-72 whitespace-pre-line">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function ProviderUsageRow({ summary }: { summary: ProviderUsageSummary }) {
  const { provider, percent } = summary;
  const color = percent === null ? undefined : usageStrokeColor(percent / 100);
  const label = provider.id === "claude" ? "Claude" : provider.label;
  const value = percent === null ? statusLabel(provider.status) : `${percent}%`;

  return (
    <div className="flex min-w-0 items-center gap-1">
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40"
        style={{ backgroundColor: color }}
      />
      <span className="truncate text-[10px] font-medium text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "shrink-0 text-[10px] font-medium",
          provider.status === "error" ? "text-red-400" : "text-muted-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function pickPrimaryBucket(buckets: ProviderUsageBucket[]): ProviderUsageBucket | null {
  if (buckets.length === 0) return null;
  return [...buckets].sort((a, b) => (b.usedPercent ?? -1) - (a.usedPercent ?? -1))[0] ?? null;
}

function statusLabel(status: ProviderUsageEntry["status"]): string {
  if (status === "error") return "err";
  return "n/a";
}

function formatTooltipLine(summary: ProviderUsageSummary): string {
  const { provider, bucket, percent } = summary;
  const bucketDetails = provider.buckets.length > 1
    ? provider.buckets.map(formatBucketDetail).join(" · ")
    : null;
  const details = [
    bucketDetails,
    bucketDetails ? null : percent === null ? statusLabel(provider.status) : `${percent}% used`,
    bucketDetails ? null : bucket?.resetsAt ? `resets ${formatReset(bucket.resetsAt)}` : null,
    bucketDetails ? null : bucket?.windowDurationMins ? `${bucket.windowDurationMins}m window` : null,
    bucket?.planType ? bucket.planType : null,
    provider.message,
  ].filter(Boolean);

  return `${provider.label}: ${details.join(" · ") || "usage unavailable"}`;
}

function formatBucketDetail(bucket: ProviderUsageBucket): string {
  const label = bucket.label ?? bucket.id;
  const percent = bucket.usedPercent === null ? "n/a" : `${bucket.usedPercent}%`;
  const reset = bucket.resetsAt ? ` resets ${formatReset(bucket.resetsAt)}` : "";
  return `${label} ${percent}${reset}`;
}

function formatReset(resetsAtSeconds: number): string {
  const deltaMs = resetsAtSeconds * 1000 - Date.now();
  if (deltaMs <= 0) return "now";
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `in ${hours}h` : `in ${hours}h ${rest}m`;
}
