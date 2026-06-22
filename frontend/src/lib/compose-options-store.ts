import type { ThinkingLevel } from "@/types";
import { SessionScopedStore } from "./session-scoped-store";

export interface StoredComposeOptions {
  thinkingLevel?: ThinkingLevel;
  planMode?: boolean;
  fastMode?: boolean;
}

// Per-conversation composer toggles (thinking level, plan/fast mode). Kept in
// memory so switching conversations and back restores the user's last choice
// instead of snapping back to the model defaults. Resets on full reload, where
// the session's persisted lastRunOptions takes over as the seed.
const composeOptionsStore = new SessionScopedStore<StoredComposeOptions>();

export function getStoredComposeOptions(
  wsId: string | undefined,
  sessionId: string | undefined,
): StoredComposeOptions | undefined {
  if (!sessionId) return undefined;
  return composeOptionsStore.get(wsId, sessionId);
}

export function setStoredComposeOptions(
  wsId: string | undefined,
  sessionId: string | undefined,
  options: StoredComposeOptions,
): void {
  if (!sessionId) return;
  composeOptionsStore.set(wsId, sessionId, options);
}
