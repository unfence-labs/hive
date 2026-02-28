import { Cron } from "croner";

/** Returns next N dates for a cron expression, or null if invalid. */
export function getNextRuns(expression: string, count: number): Date[] | null {
  if (!expression.trim()) return null;
  try {
    return new Cron(expression, { legacyMode: false }).nextRuns(count);
  } catch {
    return null;
  }
}

/** Returns the next run Date for an expression, or null if invalid. */
export function getNextRun(expression: string): Date | null {
  const runs = getNextRuns(expression, 1);
  return runs?.[0] ?? null;
}

/** Formats a millisecond delta as a short relative string. */
export function formatTimeUntil(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return "in <1m";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  if (hours < 24) return remainMin > 0 ? `in ${hours}h ${remainMin}m` : `in ${hours}h`;
  const days = Math.floor(hours / 24);
  return `in ${days}d`;
}
