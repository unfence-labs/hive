export function formatElapsed(ms: number): string {
  const totalSec = ms / 1000;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const secStr = sec < 10 && min > 0
    ? `0${sec.toFixed(1)}`
    : sec.toFixed(1);
  return min > 0 ? `${min}m ${secStr}s` : `${sec.toFixed(1)}s`;
}
