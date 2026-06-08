/**
 * Insert a value into a Set while keeping it bounded to `maxSize` entries.
 *
 * Sets preserve insertion order, so when the cap is exceeded we evict the
 * oldest entries first (FIFO). Used for long-lived dedup Sets (e.g. finalized
 * Codex app-server turn ids) that would otherwise grow unbounded across a
 * session's lifetime.
 */
export function addBounded<T>(set: Set<T>, value: T, maxSize: number): void {
  set.add(value);
  while (set.size > maxSize) {
    const oldest = set.values().next().value;
    if (oldest === undefined) break;
    set.delete(oldest);
  }
}
