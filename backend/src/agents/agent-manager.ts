import { join } from "node:path";
import { readdir, readFile, rm } from "node:fs/promises";
import { ConversationSession } from "./conversation-session.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { getWorkspace } from "../workspaces/workspace-manager.js";
import { saveProject, getDataDir, loadProject, withProjectStateLock } from "../state/state.js";
import { bareRepoPath, resolveDefaultBranch } from "../utils/paths.js";
import { NotFoundError } from "../utils/errors.js";
import type { ChatMessage, SessionMetadata } from "../types.js";

const loadedSessionsByWorkspace = new Map<string, Map<string, ConversationSession>>();
const activeSessionIds = new Map<string, string>();
const workspaceLocks = new Map<string, Promise<void>>();

export interface SessionOptions {
  command?: string;
  systemPrompt?: string | false;
  skipPermissions?: boolean;
}

async function withWorkspaceLock<T>(wsId: string, fn: () => Promise<T>): Promise<T> {
  const prev = workspaceLocks.get(wsId) ?? Promise.resolve();
  let release: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = prev.then(() => current);
  workspaceLocks.set(wsId, queued);

  await prev;
  try {
    return await fn();
  } finally {
    release?.();
    if (workspaceLocks.get(wsId) === queued) {
      workspaceLocks.delete(wsId);
    }
  }
}

function getOrCreateLoadedSessionMap(wsId: string): Map<string, ConversationSession> {
  const existing = loadedSessionsByWorkspace.get(wsId);
  if (existing) return existing;
  const created = new Map<string, ConversationSession>();
  loadedSessionsByWorkspace.set(wsId, created);
  return created;
}

function rememberLoadedSession(wsId: string, session: ConversationSession): void {
  const sessions = getOrCreateLoadedSessionMap(wsId);
  sessions.set(session.sessionId, session);
}

function getLoadedSessionById(wsId: string, sessionId: string): ConversationSession | undefined {
  return loadedSessionsByWorkspace.get(wsId)?.get(sessionId);
}

function getLoadedSessions(wsId: string): ConversationSession[] {
  return Array.from(loadedSessionsByWorkspace.get(wsId)?.values() ?? []);
}

function removeLoadedSession(wsId: string, sessionId: string): void {
  const sessions = loadedSessionsByWorkspace.get(wsId);
  if (!sessions) return;
  sessions.delete(sessionId);
  if (sessions.size === 0) {
    loadedSessionsByWorkspace.delete(wsId);
  }
  if (activeSessionIds.get(wsId) === sessionId) {
    activeSessionIds.delete(wsId);
  }
}

function setActiveSession(wsId: string, session: ConversationSession): void {
  rememberLoadedSession(wsId, session);
  activeSessionIds.set(wsId, session.sessionId);
}

function getActiveSession(wsId: string): ConversationSession | undefined {
  const activeSessionId = activeSessionIds.get(wsId);
  if (!activeSessionId) return undefined;
  return getLoadedSessionById(wsId, activeSessionId);
}

function getMostRecentlyUpdatedLoadedSession(wsId: string): ConversationSession | undefined {
  const sessions = getLoadedSessions(wsId);
  if (sessions.length === 0) return undefined;
  return sessions.sort((a, b) => {
    const aTime = new Date(a.metadata.updatedAt).getTime() || 0;
    const bTime = new Date(b.metadata.updatedAt).getTime() || 0;
    return bTime - aTime;
  })[0];
}

async function persistWorkspaceSessionState(
  projectId: string,
  wsId: string,
  status: "idle" | "busy",
  dataDir: string,
  activeSessionId?: string,
): Promise<void> {
  await withProjectStateLock(
    projectId,
    async () => {
      const latest = await loadProject(projectId, dataDir);
      if (!latest) throw new NotFoundError(`Project ${projectId} not found`);
      const ws = latest.workspaces.find((workspace) => workspace.id === wsId);
      if (!ws) throw new NotFoundError(`Workspace ${wsId} not found`);
      ws.status = status;
      ws.activeSessionId = activeSessionId;
      await saveProject(latest, dataDir);
    },
    dataDir,
  );
}

/**
 * Get or create a session for a workspace. Auto-vivifying:
 * - If an active session exists in memory, return it
 * - Otherwise create a new one (or load from disk if sessionId provided)
 */
export async function getOrCreateSession(
  wsId: string,
  dataDir = getDataDir(),
  options?: SessionOptions,
): Promise<{ session: ConversationSession; created: boolean }> {
  return withWorkspaceLock(wsId, async () => {
    const existing = getActiveSession(wsId);
    if (existing) return { session: existing, created: false };

    const ctx = await resolveWorkspaceContext(wsId, dataDir);

    // If a non-active loaded session exists (e.g. after deleting the active one),
    // make it active before creating a brand-new session.
    const fallbackLoaded = getMostRecentlyUpdatedLoadedSession(wsId);
    if (fallbackLoaded) {
      setActiveSession(wsId, fallbackLoaded);
      await persistWorkspaceSessionState(
        ctx.projectId,
        wsId,
        "busy",
        dataDir,
        fallbackLoaded.sessionId,
      );
      return { session: fallbackLoaded, created: false };
    }

    // After a server restart, try to resume the previous active session from disk
    // so Claude can continue with --resume.
    const persistedActiveId = ctx.workspace.activeSessionId;
    if (persistedActiveId) {
      try {
        const session = await loadSessionFromDisk(ctx, persistedActiveId, dataDir, options);
        setActiveSession(wsId, session);
        await persistWorkspaceSessionState(
          ctx.projectId,
          wsId,
          "busy",
          dataDir,
          session.sessionId,
        );
        return { session, created: false };
      } catch {
        // Missing/corrupt persisted active session — fall through to create new.
      }
    }

    const session = await createSession(ctx, dataDir, options);
    setActiveSession(wsId, session);
    await persistWorkspaceSessionState(
      ctx.projectId,
      wsId,
      "busy",
      dataDir,
      session.sessionId,
    );
    return { session, created: true };
  });
}

/** Get active session for a workspace (if any). */
export function getSession(wsId: string): ConversationSession | undefined {
  return getActiveSession(wsId);
}

/** Get a specific loaded session for a workspace (if present in memory). */
export function getSessionById(wsId: string, sessionId: string): ConversationSession | undefined {
  return getLoadedSessionById(wsId, sessionId);
}

function parseJsonlMessages(raw: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      messages.push(JSON.parse(line) as ChatMessage);
    } catch {
      // Skip malformed lines to preserve recoverability.
    }
  }
  return messages;
}

/**
 * Load messages for a workspace:
 * - from active in-memory session if present
 * - otherwise from the most recent persisted session on disk
 */
export async function getSessionMessages(
  wsId: string,
  dataDir = getDataDir(),
): Promise<ChatMessage[]> {
  const active = getActiveSession(wsId);
  if (active) return active.getMessages();

  const loaded = getMostRecentlyUpdatedLoadedSession(wsId);
  if (loaded) return loaded.getMessages();

  const result = await getWorkspace(wsId, dataDir);
  if (!result) throw new NotFoundError(`Workspace ${wsId} not found`);

  const { projectState, workspace } = result;
  const sessionsRoot = join(dataDir, projectState.id, "sessions");
  const candidateSessionIds: string[] = [];

  if (workspace.activeSessionId) {
    candidateSessionIds.push(workspace.activeSessionId);
  }

  try {
    const entries = await readdir(sessionsRoot, { withFileTypes: true });
    const metas: Array<{ sessionId: string; updatedAt: string }> = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const metadataPath = join(sessionsRoot, entry.name, "metadata.json");
      try {
        const rawMeta = await readFile(metadataPath, "utf-8");
        const meta = JSON.parse(rawMeta) as SessionMetadata;
        if (meta.workspaceId !== wsId) continue;
        metas.push({ sessionId: entry.name, updatedAt: meta.updatedAt });
      } catch {
        // Ignore unreadable/corrupt metadata and continue scanning.
      }
    }

    metas
      .sort((a, b) => {
        const aTime = new Date(a.updatedAt).getTime() || 0;
        const bTime = new Date(b.updatedAt).getTime() || 0;
        return bTime - aTime;
      })
      .forEach((meta) => {
        if (!candidateSessionIds.includes(meta.sessionId)) {
          candidateSessionIds.push(meta.sessionId);
        }
      });
  } catch {
    // No persisted sessions directory yet.
  }

  for (const sessionId of candidateSessionIds) {
    const messagesPath = join(sessionsRoot, sessionId, "messages.jsonl");
    try {
      const raw = await readFile(messagesPath, "utf-8");
      return parseJsonlMessages(raw);
    } catch {
      // Try next candidate.
    }
  }

  return [];
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
export function stopStreaming(wsId: string, sessionId?: string): void {
  const session = sessionId
    ? getLoadedSessionById(wsId, sessionId)
    : getActiveSession(wsId);
  if (!session) throw new Error(`No active session for workspace ${wsId}`);
  session.stop();
}

/** End all loaded sessions for a workspace and reset it to idle. */
export async function endSession(
  wsId: string,
  dataDir = getDataDir(),
): Promise<void> {
  await withWorkspaceLock(wsId, async () => {
    const sessions = getLoadedSessions(wsId);
    if (sessions.length > 0) {
      loadedSessionsByWorkspace.delete(wsId);
      activeSessionIds.delete(wsId);
      for (const session of sessions) {
        session.stop("park");
      }
    }

    const result = await getWorkspace(wsId, dataDir);
    if (!result) throw new NotFoundError(`Workspace ${wsId} not found`);
    await persistWorkspaceSessionState(
      result.projectState.id,
      wsId,
      "idle",
      dataDir,
    );
  });
}

/** Get session metadata (from active session or return null). */
export function getSessionMetadata(wsId: string): SessionMetadata | null {
  const session = getActiveSession(wsId);
  if (!session) return null;
  return session.metadata;
}

// ── Multi-session management ────────────────────────────────────────

/** Resolve workspace info needed for session operations. */
async function resolveWorkspaceContext(wsId: string, dataDir: string) {
  const result = await getWorkspace(wsId, dataDir);
  if (!result) throw new NotFoundError(`Workspace ${wsId} not found`);
  const { projectState, workspace } = result;
  const projectId = projectState.id;
  const wsPath = join(dataDir, projectId, "workspaces", workspace.name);
  const sessionDataDir = join(dataDir, projectId);
  const sessionsRoot = join(dataDir, projectId, "sessions");
  return { projectState, workspace, projectId, wsPath, sessionDataDir, sessionsRoot };
}

/** Build a system prompt for a session (extracted from getOrCreateSession). */
async function buildSessionPrompt(
  wsPath: string,
  workspace: { name: string },
  projectState: { name: string; id: string },
  dataDir: string,
  options?: SessionOptions,
): Promise<string | undefined> {
  if (options?.systemPrompt === false) return undefined;
  if (options?.systemPrompt) return options.systemPrompt;

  const bare = bareRepoPath(dataDir, projectState.id);
  let defaultBranch: string | undefined;
  try {
    defaultBranch = await resolveDefaultBranch(bare);
  } catch {
    // Falls back to detection in getGitContext
  }

  return buildSystemPrompt({
    cwd: wsPath,
    workspaceName: workspace.name,
    projectName: projectState.name,
    defaultBranch,
    branchRename: {},
    promptsDir: join(dataDir, "prompts"),
  });
}

async function createSession(
  ctx: Awaited<ReturnType<typeof resolveWorkspaceContext>>,
  dataDir: string,
  options?: SessionOptions,
): Promise<ConversationSession> {
  const systemPrompt = await buildSessionPrompt(
    ctx.wsPath,
    ctx.workspace,
    ctx.projectState,
    dataDir,
    options,
  );

  const session = new ConversationSession({
    cwd: ctx.wsPath,
    dataDir: ctx.sessionDataDir,
    workspaceId: ctx.workspace.id,
    command: options?.command,
    systemPrompt,
    skipPermissions: options?.skipPermissions,
  });
  await session.persistMetadata();
  rememberLoadedSession(ctx.workspace.id, session);
  return session;
}

async function loadSessionFromDisk(
  ctx: Awaited<ReturnType<typeof resolveWorkspaceContext>>,
  sessionId: string,
  dataDir: string,
  options?: SessionOptions,
): Promise<ConversationSession> {
  const loaded = getLoadedSessionById(ctx.workspace.id, sessionId);
  if (loaded) return loaded;

  const metaPath = join(ctx.sessionsRoot, sessionId, "metadata.json");
  let meta: SessionMetadata;
  try {
    const raw = await readFile(metaPath, "utf-8");
    meta = JSON.parse(raw) as SessionMetadata;
  } catch {
    throw new NotFoundError(`Session ${sessionId} not found`);
  }
  if (meta.workspaceId !== ctx.workspace.id) {
    throw new NotFoundError(`Session ${sessionId} does not belong to workspace ${ctx.workspace.id}`);
  }

  const systemPrompt = await buildSessionPrompt(
    ctx.wsPath,
    ctx.workspace,
    ctx.projectState,
    dataDir,
    options,
  );

  const session = await ConversationSession.load({
    sessionId,
    cwd: ctx.wsPath,
    dataDir: ctx.sessionDataDir,
    workspaceId: ctx.workspace.id,
    command: options?.command,
    systemPrompt,
    skipPermissions: options?.skipPermissions,
  });
  rememberLoadedSession(ctx.workspace.id, session);
  return session;
}

/** List all sessions for a workspace, sorted by updatedAt descending. */
export async function listWorkspaceSessions(
  wsId: string,
  dataDir = getDataDir(),
): Promise<SessionMetadata[]> {
  const result = await getWorkspace(wsId, dataDir);
  if (!result) throw new NotFoundError(`Workspace ${wsId} not found`);

  const sessionsRoot = join(dataDir, result.projectState.id, "sessions");
  const sessions: SessionMetadata[] = [];

  try {
    const entries = await readdir(sessionsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const raw = await readFile(join(sessionsRoot, entry.name, "metadata.json"), "utf-8");
        const meta = JSON.parse(raw) as SessionMetadata;
        if (meta.workspaceId !== wsId) continue;
        sessions.push(meta);
      } catch {
        // Skip unreadable/corrupt metadata.
      }
    }
  } catch {
    // No sessions directory yet.
  }

  // Enrich persisted metadata with live in-memory metadata.
  for (const loaded of getLoadedSessions(wsId)) {
    const idx = sessions.findIndex((s) => s.sessionId === loaded.sessionId);
    if (idx >= 0) {
      sessions[idx] = loaded.metadata;
    } else {
      sessions.push(loaded.metadata);
    }
  }

  sessions.sort((a, b) => {
    const aTime = new Date(a.updatedAt).getTime() || 0;
    const bTime = new Date(b.updatedAt).getTime() || 0;
    return bTime - aTime;
  });

  return sessions;
}

/** Create a new session and mark it active without stopping other loaded sessions. */
export async function createNewSession(
  wsId: string,
  dataDir = getDataDir(),
  options?: SessionOptions,
): Promise<ConversationSession> {
  return withWorkspaceLock(wsId, async () => {
    const ctx = await resolveWorkspaceContext(wsId, dataDir);
    const session = await createSession(ctx, dataDir, options);
    setActiveSession(wsId, session);
    await persistWorkspaceSessionState(
      ctx.projectId,
      wsId,
      "busy",
      dataDir,
      session.sessionId,
    );
    return session;
  });
}

/** Activate an existing session from disk without stopping other loaded sessions. */
export async function activateSession(
  wsId: string,
  sessionId: string,
  dataDir = getDataDir(),
  options?: SessionOptions,
): Promise<ConversationSession> {
  return withWorkspaceLock(wsId, async () => {
    const active = getActiveSession(wsId);
    if (active?.sessionId === sessionId) return active;

    const ctx = await resolveWorkspaceContext(wsId, dataDir);
    const session = await loadSessionFromDisk(ctx, sessionId, dataDir, options);
    setActiveSession(wsId, session);
    await persistWorkspaceSessionState(
      ctx.projectId,
      wsId,
      "busy",
      dataDir,
      sessionId,
    );

    return session;
  });
}

/** Hard-delete a session: kill if active, remove all files from disk. */
export async function hardDeleteSession(
  wsId: string,
  sessionId: string,
  dataDir = getDataDir(),
): Promise<void> {
  await withWorkspaceLock(wsId, async () => {
    const ctx = await resolveWorkspaceContext(wsId, dataDir);
    const loaded = getLoadedSessionById(wsId, sessionId);
    const wasActive = activeSessionIds.get(wsId) === sessionId;

    if (loaded) {
      removeLoadedSession(wsId, sessionId);
      // Await full shutdown (including any pending persistence) before rm.
      // The "exit" event fires after the session's persistQueue resolves,
      // so once it fires we know all writes are flushed.
      await new Promise<void>((resolve) => {
        loaded.once("exit", () => resolve());
        loaded.stop("park");
      });
    }

    const sessionDir = join(dataDir, ctx.projectId, "sessions", sessionId);
    await rm(sessionDir, { recursive: true, force: true });

    if (wasActive) {
      const nextActive = getMostRecentlyUpdatedLoadedSession(wsId);
      if (nextActive) {
        setActiveSession(wsId, nextActive);
        await persistWorkspaceSessionState(
          ctx.projectId,
          wsId,
          "busy",
          dataDir,
          nextActive.sessionId,
        );
      } else {
        await persistWorkspaceSessionState(
          ctx.projectId,
          wsId,
          "idle",
          dataDir,
        );
      }
    }
  });
}

/** Get messages for a specific session (from memory if active, otherwise from disk). */
export async function getSpecificSessionMessages(
  wsId: string,
  sessionId: string,
  dataDir = getDataDir(),
): Promise<ChatMessage[]> {
  const loaded = getLoadedSessionById(wsId, sessionId);
  if (loaded) return loaded.getMessages();

  const result = await getWorkspace(wsId, dataDir);
  if (!result) throw new NotFoundError(`Workspace ${wsId} not found`);

  const messagesPath = join(dataDir, result.projectState.id, "sessions", sessionId, "messages.jsonl");
  try {
    const raw = await readFile(messagesPath, "utf-8");
    return parseJsonlMessages(raw);
  } catch {
    return [];
  }
}

// ── Test helpers ────────────────────────────────────────────────────

/** For testing: clear all active sessions. */
export function _clearActiveSessions(): void {
  for (const sessions of loadedSessionsByWorkspace.values()) {
    for (const session of sessions.values()) {
      session.stop("park");
    }
  }
  loadedSessionsByWorkspace.clear();
  activeSessionIds.clear();
  workspaceLocks.clear();
}
