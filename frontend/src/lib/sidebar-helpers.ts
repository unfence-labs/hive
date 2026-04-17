import type { Automation } from "@/types";

export function parseProjectOwnerRepo(
  url: string,
): { owner: string; repo: string } | null {
  const scpMatch = url.match(/^[^@]+@[^:]+:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (scpMatch) return { owner: scpMatch[1], repo: scpMatch[2] };

  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length >= 2) {
      return { owner: segments[0], repo: segments[1].replace(/\.git$/, "") };
    }
  } catch {
    // not a valid URL
  }

  return null;
}

export function automationSortKey(automation: Automation): number {
  if (automation.lastRunStatus === "running") return 0;
  if (automation.enabled) return 1;
  return 2;
}

export function describeSchedule(expression: string): string {
  const presets: Record<string, string> = {
    "0 * * * *": "Hourly",
    "0 */6 * * *": "Every 6h",
    "0 2 * * *": "Daily 2am",
    "0 8 * * *": "Daily 8am",
    "0 0 * * *": "Daily midnight",
    "0 9 * * 1-5": "Weekdays 9am",
    "0 9 * * 1": "Weekly Mon",
  };

  return presets[expression] ?? expression;
}
