/**
 * Canonical compact token format, shared by the context ring and the goal panel:
 * 842 → "842", 15200 → "15.2k", 123456 → "123k", 1500000 → "1.5m".
 */
export function formatTokenCount(tokens: number): string {
  if (tokens < 1_000) return String(tokens);
  if (tokens < 100_000) return `${(tokens / 1_000).toFixed(1)}k`;
  if (tokens < 1_000_000) {
    const thousands = Math.round(tokens / 1_000);
    // Rounding can push e.g. 999_999 up to 1000k — roll over to millions.
    if (thousands >= 1_000) return "1.0m";
    return `${thousands}k`;
  }
  return `${(tokens / 1_000_000).toFixed(1)}m`;
}

/** Get the SVG stroke color for a usage fraction (0-1). */
export function usageStrokeColor(fraction: number): string {
  if (fraction < 0.5) return "var(--success)";
  if (fraction < 0.8) return "var(--warning)";
  return "var(--destructive)";
}
