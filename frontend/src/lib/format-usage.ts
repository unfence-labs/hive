/** Format token counts: 842 → "842", 15200 → "15.2K", 123456 → "123K", 1500000 → "1.5M" */
export function formatTokenCount(tokens: number): string {
  if (tokens < 1_000) return String(tokens);
  if (tokens < 100_000) return `${(tokens / 1_000).toFixed(1)}K`;
  if (tokens < 1_000_000) return `${Math.round(tokens / 1_000)}K`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

/** Format USD cost: 0.004 → "$0.004", 1.23 → "$1.23" */
export function formatCostUsd(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

/** Get the SVG stroke color hex for a usage fraction (0-1). */
export function usageStrokeColor(fraction: number): string {
  if (fraction < 0.5) return "#34d399"; // emerald-400
  if (fraction < 0.8) return "#facc15"; // yellow-400
  return "#f87171"; // red-400
}
