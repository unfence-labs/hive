import { join } from "node:path";
import { ConversationSession } from "./conversation-session.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { getWorkspace } from "../workspaces/workspace-manager.js";
import { saveProject, getDataDir } from "../state/state.js";
import { bareRepoPath, resolveDefaultBranch } from "../utils/paths.js";
import type { SessionMetadata } from "../types.js";

const activeSessions = new Map<string, ConversationSession>();

export interface SessionOptions {
  command?: string;
  systemPrompt?: string | false;
}

/**
 * Get or create a session for a workspace. Auto-vivifying:
 * - If a session exists in memory, return it
 * - Otherwise create a new one (or load from disk if sessionId provided)
 */
export async function getOrCreateSession(
  wsId: string,
  dataDir = getDataDir(),
  options?: SessionOptions,
): Promise<{ session: ConversationSession; created: boolean }> {
  const existing = activeSessions.get(wsId);
  if (existing) return { session: existing, created: false };

  const result = await getWorkspace(wsId, dataDir);
  if (!result) throw new Error(`Workspace ${wsId} not found`);

  const { projectState, workspace } = result;
  if (workspace.status === "busy") {
    // Sessions are in-memory only. If backend restarted, a workspace can remain
    // persisted as busy without an active session in memory; recover it.
    workspace.status = "idle";
    workspace.activeSessionId = undefined;
    await saveProject(projectState, dataDir);
  }

  const wsPath = join(dataDir, projectState.id, "workspaces", workspace.name);
  const sessionDataDir = join(dataDir, projectState.id);

  // Build system prompt unless explicitly disabled (e.g. in tests)
  let systemPrompt: string | undefined;
  if (options?.systemPrompt !== false) {
    const bare = bareRepoPath(dataDir, projectState.id);
    let defaultBranch: string | undefined;
    try {
      defaultBranch = await resolveDefaultBranch(bare);
    } catch {
      // Falls back to detection in getGitContext
    }

    systemPrompt = options?.systemPrompt ?? await buildSystemPrompt({
      cwd: wsPath,
      workspaceName: workspace.name,
      projectName: projectState.name,
      defaultBranch,
      branchRename: {},
    });
  }

  const session = new ConversationSession({
    cwd: wsPath,
    dataDir: sessionDataDir,
    workspaceId: wsId,
    command: options?.command,
    systemPrompt,
  });

  activeSessions.set(wsId, session);

  workspace.status = "busy";
  workspace.activeSessionId = session.sessionId;
  await saveProject(projectState, dataDir);

  return { session, created: true };
}

/** Get active session for a workspace (if any). */
export function getSession(wsId: string): ConversationSession | undefined {
  return activeSessions.get(wsId);
}

/** Send a message in the workspace's active session. Auto-creates session if needed. */
export async function sendMessage(
  wsId: string,
  content: string,
  dataDir = getDataDir(),
  options?: SessionOptions,
): Promise<ConversationSession> {
  const { session } = await getOrCreateSession(wsId, dataDir, options);
  session.sendMessage(content);
  return session;
}

/** Stop the currently streaming process (but keep session alive). */
export function stopStreaming(wsId: string): void {
  const session = activeSessions.get(wsId);
  if (!session) throw new Error(`No active session for workspace ${wsId}`);
  session.stop();
}

/** End a session entirely — kill process, remove from active map, reset workspace to idle. */
export async function endSession(
  wsId: string,
  dataDir = getDataDir(),
): Promise<void> {
  const session = activeSessions.get(wsId);
  if (session) {
    activeSessions.delete(wsId);
    session.stop();
  }

  const result = await getWorkspace(wsId, dataDir);
  if (!result) throw new Error(`Workspace ${wsId} not found`);

  result.workspace.status = "idle";
  result.workspace.activeSessionId = undefined;
  await saveProject(result.projectState, dataDir);
}

/** Get session metadata (from active session or return null). */
export function getSessionMetadata(wsId: string): SessionMetadata | null {
  const session = activeSessions.get(wsId);
  if (!session) return null;
  return session.metadata;
}

// ── Test helpers ────────────────────────────────────────────────────

/** For testing: clear all active sessions. */
export function _clearActiveSessions(): void {
  for (const [, session] of activeSessions) {
    session.stop();
  }
  activeSessions.clear();
}
