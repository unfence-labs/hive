const DEFAULT_WORKSPACE_KEY = "__workspace_default__";

/**
 * In-memory store keyed by (workspaceId, sessionId). Values survive workspace
 * and session switches within a single app session but reset on full reload.
 * Used to keep per-conversation composer state (drafts, run options) sticky.
 */
export class SessionScopedStore<T> {
  private readonly buckets = new Map<string, Map<string, T>>();

  private bucket(wsId: string | undefined, create: boolean): Map<string, T> | undefined {
    const key = wsId ?? DEFAULT_WORKSPACE_KEY;
    let bucket = this.buckets.get(key);
    if (!bucket && create) {
      bucket = new Map<string, T>();
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  get(wsId: string | undefined, sessionId: string): T | undefined {
    return this.bucket(wsId, false)?.get(sessionId);
  }

  set(wsId: string | undefined, sessionId: string, value: T): void {
    this.bucket(wsId, true)!.set(sessionId, value);
  }

  delete(wsId: string | undefined, sessionId: string): void {
    this.bucket(wsId, false)?.delete(sessionId);
  }
}
