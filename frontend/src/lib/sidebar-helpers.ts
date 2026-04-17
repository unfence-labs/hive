import type { Automation } from "@/types";

function parseRepoPath(path: string): { owner: string; repo: string } | null {
  const segments = path.split("/").filter(Boolean);
  if (segments.length < 2) return null;

  const owner = segments[segments.length - 2];
  const repo = segments[segments.length - 1]?.replace(/\.git$/, "");
  if (!owner || !repo) return null;

  return { owner, repo };
}

export function parseProjectOwnerRepo(
  url: string,
): { owner: string; repo: string } | null {
  const scpMatch = url.match(/^[^@]+@[^:]+:(.+)$/);
  if (scpMatch) return parseRepoPath(scpMatch[1]);

  try {
    const parsed = new URL(url);
    return parseRepoPath(parsed.pathname);
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
