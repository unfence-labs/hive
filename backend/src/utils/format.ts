/**
 * Format a duration in milliseconds to a human-friendly string.
 * Uses whole seconds: "1m 32s", "45s", "0s".
 */
export function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min > 0) return `${min}m ${sec}s`;
  return `${sec}s`;
}
