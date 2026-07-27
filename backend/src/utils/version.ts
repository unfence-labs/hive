/**
 * Compare two dotted numeric version strings, segment by segment with missing
 * segments read as 0. Positive when `a` is newer, negative when `b` is, 0 when
 * equal. Any non-numeric segment answers NaN, so every comparison against the
 * result is false — ambiguity must never claim an ordering.
 */
export function compareVersions(a: string, b: string): number {
  const aParts = a.split(".").map(Number);
  const bParts = b.split(".").map(Number);
  const length = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < length; i++) {
    const left = aParts[i] ?? 0;
    const right = bParts[i] ?? 0;
    if (Number.isNaN(left) || Number.isNaN(right)) return Number.NaN;
    if (left !== right) return left - right;
  }
  return 0;
}
