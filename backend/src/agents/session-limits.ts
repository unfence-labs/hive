import { ConflictError } from "../utils/errors.js";

/**
 * Maximum coexisting sessions per conversation context — a workspace or the
 * Brain, which share the same rule. The clients disable the "new conversation"
 * button at this count (`MAX_SESSIONS_PER_WORKSPACE` in frontend
 * ConversationTabs.tsx, `maxSessions` in iOS ConversationsSection.swift); this
 * module is the single server-side guard both Brain and workspace session
 * creation enforce, so the limit can't diverge between the two.
 */
export const MAX_SESSIONS_PER_WORKSPACE = 6;

/**
 * Reject creating another session once a context is already at the cap, as a
 * 409 the API surfaces (instead of letting an over-cap create succeed in one
 * place and fail in another). `scopeLabel` completes "Maximum of N <label>
 * reached" (e.g. "sessions", "Brain sessions").
 */
export function assertSessionCapacity(existingCount: number, scopeLabel: string): void {
  if (existingCount >= MAX_SESSIONS_PER_WORKSPACE) {
    throw new ConflictError(`Maximum of ${MAX_SESSIONS_PER_WORKSPACE} ${scopeLabel} reached`);
  }
}
