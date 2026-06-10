import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useProviderUsage, type ProviderUsageBucket, type ProviderUsageEntry } from "@/hooks/useProviderUsage";
import { usageStrokeColor } from "@/lib/format-usage";

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

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="grid w-full grid-cols-3 items-center gap-2.5 cursor-default">
            {summaries.map((summary) => (
              <ProviderUsageRow
                key={summary.provider.id}
                summary={summary}
              />
            ))}
          </div>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="w-64 max-w-[calc(100vw-2rem)] bg-zinc-950 px-2.5 py-2 text-zinc-100 shadow-lg [&>svg]:!bg-zinc-950 [&>svg]:!fill-zinc-950"
        >
          <div className="grid gap-1.5">
            {summaries.map((summary) => (
              <ProviderUsageDetails
                key={summary.provider.id}
                summary={summary}
              />
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function ProviderUsageRow({ summary }: { summary: ProviderUsageSummary }) {
  const { provider, percent } = summary;
  const color = percent === null ? undefined : usageStrokeColor(percent / 100);
  const label = provider.id === "claude" ? "Claude" : provider.label;

  return (
    <div className="flex min-w-0 items-center gap-1">
      <span className="w-9 shrink-0 truncate text-[10px] font-medium text-muted-foreground">
        {label}
      </span>
      <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-border dark:bg-muted/40">
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{
            width: percent === null ? "0%" : `${percent}%`,
            backgroundColor: color,
          }}
        />
      </div>
    </div>
  );
}

function ProviderUsageDetails({ summary }: { summary: ProviderUsageSummary }) {
  const { provider } = summary;
  const buckets = provider.buckets.length > 0 ? sortProviderBuckets(provider) : [null];

  return (
    <div className="grid gap-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        {provider.id === "claude" ? "Claude" : provider.label}
      </div>
      <div className="grid gap-1">
        {buckets.map((bucket, index) => (
          <ProviderUsageBucketDetail
            key={bucket?.id ?? `${provider.id}-${index}`}
            provider={provider}
            bucket={bucket}
          />
        ))}
      </div>
      {provider.message ? (
        <div className="max-w-full truncate text-[10px] leading-snug text-zinc-400">
          {provider.message}
        </div>
      ) : null}
    </div>
  );
}

function ProviderUsageBucketDetail({
  provider,
  bucket,
}: {
  provider: ProviderUsageEntry;
  bucket: ProviderUsageBucket | null;
}) {
  if (!bucket) {
    return (
      <div className="grid grid-cols-[5.5rem_1fr_2.25rem] items-center gap-2 text-[10px]">
        <span className="truncate font-medium text-zinc-200">
          {provider.id === "claude" ? "Claude" : provider.label}
        </span>
        <div className="h-1 overflow-hidden rounded-full bg-zinc-700" />
        <span className="text-right tabular-nums text-zinc-400">
          {statusLabel(provider.status)}
        </span>
      </div>
    );
  }

  const percent = bucket.usedPercent === null ? null : bucket.usedPercent;
  const color = percent === null ? undefined : usageStrokeColor(percent / 100);
  const providerLabel = provider.id === "claude" ? "Claude" : provider.label;
  const bucketLabel = bucket.label ?? (bucket.id === provider.id ? null : bucket.id);
  const label = provider.buckets.length > 1 && bucketLabel
    ? `${providerLabel} ${bucketLabel}`
    : providerLabel;
  const reset = bucket.resetsAt ? formatCompactReset(bucket.resetsAt) : null;

  return (
    <div className="grid grid-cols-[5.5rem_1fr_4rem] items-center gap-2 text-[10px]">
      <span className="min-w-0 truncate font-medium text-zinc-200">
        {label}
      </span>
      <div className="h-1 overflow-hidden rounded-full bg-zinc-700">
        <div
          className="h-full rounded-full"
          style={{
            width: percent === null ? "0%" : `${percent}%`,
            backgroundColor: color,
          }}
        />
      </div>
      <span className="text-right tabular-nums text-zinc-400">
        {percent === null ? "n/a" : `${percent}%`}
        {reset ? ` ${reset}` : ""}
      </span>
    </div>
  );
}

function pickPrimaryBucket(buckets: ProviderUsageBucket[]): ProviderUsageBucket | null {
  if (buckets.length === 0) return null;
  return [...buckets].sort((a, b) => (b.usedPercent ?? -1) - (a.usedPercent ?? -1))[0] ?? null;
}

function sortProviderBuckets(provider: ProviderUsageEntry): ProviderUsageBucket[] {
  return [...provider.buckets].sort((a, b) => {
    if (a.id === provider.id && b.id !== provider.id) return -1;
    if (b.id === provider.id && a.id !== provider.id) return 1;
    return 0;
  });
}

function statusLabel(status: ProviderUsageEntry["status"]): string {
  if (status === "error") return "err";
  return "n/a";
}

function formatCompactReset(resetsAtSeconds: number): string {
  const deltaMs = resetsAtSeconds * 1000 - Date.now();
  if (deltaMs <= 0) return "now";
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}
