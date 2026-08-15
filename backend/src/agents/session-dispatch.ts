import * as workspaceManager from "./agent-manager.js";
import * as brainManager from "./brain-manager.js";
import { BRAIN_WORKSPACE_ID } from "./brain-manager.js";
import { getDataDir } from "../state/state.js";
import type { ConversationSession } from "./conversation-session.js";
import type { ChatMessage, SessionKind, SessionMetadata } from "../types.js";
import type { SessionOptions } from "./agent-manager.js";

/**
 * Unified session dispatch keyed by workspace id.
 *
 * The Brain (`wsId === "brain"`) is backed by a dedicated session manager that
 * cannot reuse the workspace-coupled {@link import("./agent-manager.js")}, but
 * both expose the same {@link ConversationSession}-based surface. This module
 * routes each call to the correct manager so the WS hub and session routes stay
 * agnostic to which one is in play — no duplicated session logic.
 */
function isBrain(wsId: string): boolean {
  return wsId === BRAIN_WORKSPACE_ID;
}

export async function getOrCreateSession(
  wsId: string,
  dataDir = getDataDir(),
  options?: SessionOptions,
): Promise<{ session: ConversationSession; created: boolean }> {
  return isBrain(wsId)
    ? brainManager.getOrCreateBrainSession(dataDir, options)
    : workspaceManager.getOrCreateSession(wsId, dataDir, options);
}

export function getSession(wsId: string): ConversationSession | undefined {
  return isBrain(wsId) ? brainManager.getBrainSession() : workspaceManager.getSession(wsId);
}

export function isLoadedDefaultSessionCandidate(
  wsId: string,
  session: ConversationSession,
): boolean {
  // The Brain has a single shared session and no terminal/empty-skip concept:
  // getDefaultBrainSessionId always resolves the active session, so a loaded
  // brain session is always its own default. Keep this in sync with that.
  return isBrain(wsId) || workspaceManager.isLoadedDefaultSessionCandidate(session);
}

export function getSessionById(wsId: string, sessionId: string): ConversationSession | undefined {
  return isBrain(wsId)
    ? brainManager.getBrainSessionById(sessionId)
    : workspaceManager.getSessionById(wsId, sessionId);
}

export function getStreamingSessionIds(wsId: string): string[] {
  return isBrain(wsId)
    ? brainManager.getStreamingBrainSessionIds()
    : workspaceManager.getStreamingSessionIds(wsId);
}

export function stopStreaming(wsId: string, sessionId?: string): void {
  if (isBrain(wsId)) brainManager.stopBrainStreaming(sessionId);
  else workspaceManager.stopStreaming(wsId, sessionId);
}

export async function getSessionMessages(
  wsId: string,
  dataDir = getDataDir(),
): Promise<ChatMessage[]> {
  return isBrain(wsId)
    ? brainManager.getBrainSessionMessages(dataDir)
    : workspaceManager.getSessionMessages(wsId, dataDir);
}

export async function getSpecificSessionMessages(
  wsId: string,
  sessionId: string,
  dataDir = getDataDir(),
): Promise<ChatMessage[]> {
  return isBrain(wsId)
    ? brainManager.getSpecificBrainSessionMessages(sessionId, dataDir)
    : workspaceManager.getSpecificSessionMessages(wsId, sessionId, dataDir);
}

export async function listWorkspaceSessions(
  wsId: string,
  dataDir = getDataDir(),
): Promise<SessionMetadata[]> {
  return isBrain(wsId)
    ? brainManager.listBrainSessions(dataDir)
    : workspaceManager.listWorkspaceSessions(wsId, dataDir);
}

export async function markSessionRead(
  wsId: string,
  sessionId: string,
  throughCount: number,
  dataDir = getDataDir(),
): Promise<SessionMetadata> {
  return isBrain(wsId)
    ? brainManager.markBrainSessionRead(sessionId, throughCount, dataDir)
    : workspaceManager.markSessionRead(wsId, sessionId, throughCount, dataDir);
}

export async function getUnreadSessions(
  wsId: string,
  dataDir = getDataDir(),
): Promise<Array<{
  sessionId: string;
  assistantMessageCount: number;
  readAssistantMessageCount: number;
}>> {
  const sessions = await listWorkspaceSessions(wsId, dataDir);
  return sessions
    .filter((metadata) =>
      metadata.kind !== "terminal"
      && metadata.assistantMessageCount > metadata.readAssistantMessageCount
    )
    .map(({ sessionId, assistantMessageCount, readAssistantMessageCount }) => ({
      sessionId,
      assistantMessageCount,
      readAssistantMessageCount,
    }));
}

/** Session a fresh client should open for a workspace (metadata only). */
export async function getDefaultSessionId(
  wsId: string,
  dataDir = getDataDir(),
): Promise<string | undefined> {
  return isBrain(wsId)
    ? brainManager.getDefaultBrainSessionId(dataDir)
    : workspaceManager.getDefaultSessionId(wsId, dataDir);
}

export async function createNewSession(
  wsId: string,
  dataDir = getDataDir(),
  options?: SessionOptions,
  kind: SessionKind = "chat",
): Promise<ConversationSession> {
  // The Brain is always a "brain" session, so it ignores the requested kind.
  return isBrain(wsId)
    ? brainManager.createNewBrainSession(dataDir, options)
    : workspaceManager.createNewSession(wsId, dataDir, options, kind);
}

export async function activateSession(
  wsId: string,
  sessionId: string,
  dataDir = getDataDir(),
  options?: SessionOptions,
): Promise<ConversationSession> {
  return isBrain(wsId)
    ? brainManager.activateBrainSession(sessionId, dataDir, options)
    : workspaceManager.activateSession(wsId, sessionId, dataDir, options);
}

export async function convertSessionToTerminal(
  wsId: string,
  sessionId: string,
  dataDir = getDataDir(),
): Promise<SessionMetadata> {
  // Terminal sessions are workspace-only; the Brain never hosts a shell.
  if (isBrain(wsId)) {
    throw new Error("Terminal sessions are not supported in the Brain");
  }
  return workspaceManager.convertSessionToTerminal(wsId, sessionId, dataDir);
}

export async function hardDeleteSession(
  wsId: string,
  sessionId: string,
  dataDir = getDataDir(),
): Promise<void> {
  return isBrain(wsId)
    ? brainManager.hardDeleteBrainSession(sessionId, dataDir)
    : workspaceManager.hardDeleteSession(wsId, sessionId, dataDir);
}

export function getSessionMetadata(wsId: string): SessionMetadata | null {
  if (isBrain(wsId)) return brainManager.getBrainSession()?.metadata ?? null;
  return workspaceManager.getSessionMetadata(wsId);
}

export async function endSession(wsId: string, dataDir = getDataDir()): Promise<void> {
  // The Brain has no workspace "idle/busy" state to reset; ending is a no-op
  // beyond stopping the active stream (handled per-session via `stop`).
  if (isBrain(wsId)) return;
  return workspaceManager.endSession(wsId, dataDir);
}

export async function resolveSessionAttachmentPath(
  wsId: string,
  sessionId: string,
  filename: string,
  dataDir = getDataDir(),
): Promise<string | null> {
  return isBrain(wsId)
    ? brainManager.resolveBrainSessionAttachmentPath(sessionId, filename, dataDir)
    : workspaceManager.resolveSessionAttachmentPath(wsId, sessionId, filename, dataDir);
}
