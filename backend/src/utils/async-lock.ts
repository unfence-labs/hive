/**
 * Run `fn` with exclusive access for `key`, serializing concurrent callers that
 * share the same key against the provided lock map. Callers with different keys
 * run concurrently. The map entry is removed once its queue drains, so the map
 * does not grow unbounded.
 *
 * Shared by the workspace, Brain, and project-state managers so they don't each
 * re-implement the queue-and-release pattern.
 */
export async function withKeyedLock<T>(
  locks: Map<string, Promise<void>>,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  let release: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = prev.then(() => current);
  locks.set(key, queued);

  await prev;
  try {
    return await fn();
  } finally {
    release?.();
    if (locks.get(key) === queued) {
      locks.delete(key);
    }
  }
}
