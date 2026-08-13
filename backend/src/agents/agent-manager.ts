import { join } from "node:path";
import { readdir, readFile, rm } from "node:fs/promises";
import { ConversationSession } from "./conversation-session.js";
import { buildPrompt, getGitContext, loadBasePrompt } from "./system-prompt.js";
import { getWorkspace } from "../workspaces/workspace-manager.js";
import { saveProject, getDataDir, loadProject, withProjectStateLock } from "../state/state.js";
import { bareRepoPath, resolveDefaultBranch } from "../utils/paths.js";
import { runNamingTask } from "./naming.js";
import { NotFoundError } from "../utils/errors.js";
import { assertSessionCapacity } from "./session-limits.js";
import { extractSummary, extractPreview } from "../utils/summary-extractor.js";
import { withKeyedLock } from "../utils/async-lock.js";
import { parseJsonlMessages, sortByUpdatedAtDesc } from "./session-utils.js";
import { readSessionMetadata, updateSessionMetadata } from "./session-metadata.js";
import { removeTerminal } from "../services/terminal-runner.js";
import type { ChatMessage, SessionKind, SessionMetadata, WorkspaceSource } from "../types.js";
import { Notifier } from "../notifications/notifier.js";
import { TelegramChannel } from "../notifications/telegram.js";
import { browserSessionManager } from "../services/browser-session-manager.js";
import type { AppConfig } from "../state/config.js";

let notifier: Notifier | undefined;

export function setNotifier(n: Notifier): void {
  notifier = n;
}

export function getNotifier(): Notifier | undefined {
  return notifier;
}

export function rebuildNotifier(config: AppConfig): void {
  const channels = [];
  const tg = config.notifications.telegram;
  if (tg.enabled) {
    const ch = TelegramChannel.fromConfig(tg);
    if (ch) channels.push(ch);
  }
  setNotifier(new Notifier(channels));
}

const loadedSessionsByWorkspace = new Map<string, Map<string, ConversationSession>>();
const activeSessionIds = new Map<string, string>();
const workspaceLocks = new Map<string, Promise<void>>();
const workspaceBranchRenameLocks = new Map<string, Promise<void>>();

export interface SessionOptions {
  command?: string;
  systemPrompt?: string | false;
  skipPermissions?: boolean;
}

async function withWorkspaceLock<T>(wsId: string, fn: () => Promise<T>): Promise<T> {
  return withKeyedLock(workspaceLocks, wsId, fn);
}

async function withWorkspaceBranchRenameLock<T>(wsId: string, fn: () => Promise<T>): Promise<T> {
  return withKeyedLock(workspaceBranchRenameLocks, wsId, fn);
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

function getMostRecentLoadedSession(
  wsId: string,
  predicate: (session: ConversationSession) => boolean,
): ConversationSession | undefined {
  const sessions = getLoadedSessions(wsId).filter(predicate);
  if (sessions.length === 0) return undefined;
  const sorted = sortByUpdatedAtDesc(sessions.map((s) => s.metadata));
  return sorted[0] ? getLoadedSessionById(wsId, sorted[0].sessionId) : undefined;
}

function getMostRecentlyUpdatedLoadedSession(wsId: string): ConversationSession | undefined {
  // Terminal sessions are never the active chat session: they render a shell,
  // not a conversation, and silently no-op sendMessage. Skip them here so they
  // are never auto-promoted to active.
  return getMostRecentLoadedSession(wsId, (s) => s.metadata.kind !== "terminal");
}

function isPersistedDefaultSessionCandidate(meta: SessionMetadata): boolean {
  return meta.kind !== "terminal" && (
    meta.assistantMessageCount > 0 ||
    Boolean(meta.draftPrompt)
  );
}

export function isLoadedDefaultSessionCandidate(session: ConversationSession): boolean {
  return session.metadata.kind !== "terminal" && (
    session.metadata.assistantMessageCount > 0 ||
    Boolean(session.metadata.draftPrompt) ||
    session.status === "streaming"
  );
}

function getMostRecentlyUpdatedDefaultLoadedSession(wsId: string): ConversationSession | undefined {
  return getMostRecentLoadedSession(wsId, isLoadedDefaultSessionCandidate);
}

async function persistWorkspaceSessionState(
  projectId: string,
  wsId: string,
  status: "idle" | "busy",
  dataDir: string,
  activeSessionId?: string,
  draftPromptToConsume?: string,
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
      // A new chat session persists the prompt in its own metadata before
      // removing the workspace copy. Compare the expected value so a concurrent
      // prompt update cannot be erased accidentally.
      if (draftPromptToConsume && ws.draftPrompt === draftPromptToConsume) {
        delete ws.draftPrompt;
      }
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
        // A terminal session must never be resumed as the active chat session:
        // it renders a shell over the chat UI and silently no-ops sendMessage.
        // Fall through to create a fresh chat session instead.
        if (session.metadata.kind !== "terminal") {
          setActiveSession(wsId, session);
          await persistWorkspaceSessionState(
            ctx.projectId,
            wsId,
            "busy",
            dataDir,
            session.sessionId,
          );
          return { session, created: false };
        }
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
      session.metadata.draftPrompt,
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
        const meta = await readSessionMetadata(metadataPath);
        if (meta.workspaceId !== wsId) continue;
        metas.push({ sessionId: entry.name, updatedAt: meta.updatedAt });
      } catch {
        // Ignore unreadable/corrupt metadata and continue scanning.
      }
    }

    sortByUpdatedAtDesc(metas)
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
    browserSessionManager.closeWorkspace(wsId);

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
  workspace: { name: string; source?: WorkspaceSource },
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

  const base = await loadBasePrompt(join(dataDir, "prompts"));
  const ctx = await getGitContext(wsPath, defaultBranch);

  return buildPrompt("chat", {
    base,
    interpolation: {
      projectName: projectState.name ?? "unknown",
      cwd: wsPath,
      defaultBranch: ctx.defaultBranch,
    },
    git: ctx,
    projectName: projectState.name,
    workspaceName: workspace.name,
    source: workspace.source,
  }).text;
}

function attachNotificationListener(
  session: ConversationSession,
  ctx: { workspace: { id: string; name: string }; projectState: { name: string } },
): void {
  if (!notifier) return;
  const n = notifier;
  const baseCtx = {
    workspaceId: ctx.workspace.id,
    workspaceName: ctx.workspace.name,
    projectName: ctx.projectState.name,
    sessionId: session.sessionId,
  };

  session.on("message", (msg) => {
    if (msg.type === "done") {
      if (msg.pendingToolName === "AskUserQuestion") {
        n.notify({ type: "agent_needs_input", ...baseCtx }).catch(() => {});
      } else if (msg.pendingToolName === "ExitPlanMode") {
        n.notify({ type: "agent_proposed_plan", ...baseCtx }).catch(() => {});
      } else {
        void (async () => {
          let summary: string | undefined;
          try {
            const messages = await session.getMessages();
            summary = extractSummary(messages) ?? extractPreview(messages);
          } catch { /* non-fatal */ }
          n.notify({
            type: "agent_turn_complete",
            ...baseCtx,
            durationMs: msg.durationMs,
            summary,
          }).catch(() => {});
        })();
      }
    } else if (msg.type === "cancelled" && !msg.userInitiated) {
      n.notify({
        type: "agent_failed",
        ...baseCtx,
        durationMs: msg.durationMs,
        errorDetail: msg.errorDetail,
      }).catch(() => {});
    }
  });
}

async function attachBrowserEnv(
  session: ConversationSession,
  workspaceId: string,
  options?: SessionOptions,
): Promise<void> {
  if (options?.command) return;
  await browserSessionManager.ensureSession(workspaceId, session.sessionId);
  session.setBrowserEnv(browserSessionManager.getEnv(workspaceId, session.sessionId));
}

async function createSession(
  ctx: Awaited<ReturnType<typeof resolveWorkspaceContext>>,
  dataDir: string,
  options?: SessionOptions,
  kind: SessionKind = "chat",
): Promise<ConversationSession> {
  // Terminal sessions host a shell PTY, not an agent, so they never need a
  // system prompt. Building one only does unnecessary work.
  const systemPrompt =
    kind === "terminal"
      ? undefined
      : await buildSessionPrompt(
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
    sessionKind: kind,
    draftPrompt: kind === "chat" ? ctx.workspace.draftPrompt : undefined,
  });
  await attachBrowserEnv(session, ctx.workspace.id, options);
  await session.persistMetadata();
  attachNotificationListener(session, ctx);

  // Auto-name branch and session title on first message
  session.once("first_message", (content: string) => {
    void runNamingTask(
      {
        userMessage: content,
        cwd: ctx.wsPath,
        bareRepo: bareRepoPath(dataDir, ctx.projectId),
        currentBranch: ctx.workspace.branch,
        workspaceName: ctx.workspace.name,
        command: options?.command,
        withBranchRenameLock: (fn) => withWorkspaceBranchRenameLock(ctx.workspace.id, fn),
      },
      (title: string) => session.setTitle(title),
    ).catch((err) => {
      console.warn("[naming] naming task failed:", err);
    });
  });

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
    meta = await readSessionMetadata(metaPath);
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
  await attachBrowserEnv(session, ctx.workspace.id, options);
  attachNotificationListener(session, ctx);
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
        const meta = await readSessionMetadata(
          join(sessionsRoot, entry.name, "metadata.json"),
        );
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

  sortByUpdatedAtDesc(sessions);

  return sessions;
}

/**
 * Resolve the session a fresh client should open for this workspace, WITHOUT
 * reading any message bodies (metadata only). Order: default-worthy in-memory
 * active/most-recent loaded session, else the persisted active session if it
 * has content, else the most-recently-updated non-empty chat. Empty idle and
 * terminal sessions are skipped so a first open lands on real history instead
 * of a blank "new conversation".
 * Returns undefined only when the workspace has no non-empty conversation.
 */
export async function getDefaultSessionId(
  wsId: string,
  dataDir = getDataDir(),
): Promise<string | undefined> {
  const active = getActiveSession(wsId);
  if (active && isLoadedDefaultSessionCandidate(active)) return active.sessionId;

  const loaded = getMostRecentlyUpdatedDefaultLoadedSession(wsId);
  if (loaded) return loaded.sessionId;

  const sessions = await listWorkspaceSessions(wsId, dataDir); // sorted updatedAt-desc
  const nonEmptyChats = sessions.filter(isPersistedDefaultSessionCandidate);
  if (nonEmptyChats.length === 0) return undefined;

  const result = await getWorkspace(wsId, dataDir);
  const persistedActive = result?.workspace.activeSessionId;
  if (persistedActive && nonEmptyChats.some((s) => s.sessionId === persistedActive)) {
    return persistedActive;
  }
  return nonEmptyChats[0].sessionId;
}

/** Create a new session and mark it active without stopping other loaded sessions. */
export async function createNewSession(
  wsId: string,
  dataDir = getDataDir(),
  options?: SessionOptions,
  kind: SessionKind = "chat",
): Promise<ConversationSession> {
  return withWorkspaceLock(wsId, async () => {
    const ctx = await resolveWorkspaceContext(wsId, dataDir);
    // Terminal tabs are a separate surface and don't count toward the
    // conversation cap; only chat sessions are capped, and opening a terminal is
    // never blocked by it.
    if (kind !== "terminal") {
      const chatCount = (await listWorkspaceSessions(wsId, dataDir)).filter(
        (s) => s.kind !== "terminal",
      ).length;
      assertSessionCapacity(chatCount, "sessions");
    }
    const session = await createSession(ctx, dataDir, options, kind);
    setActiveSession(wsId, session);
    await persistWorkspaceSessionState(
      ctx.projectId,
      wsId,
      "busy",
      dataDir,
      session.sessionId,
      session.metadata.draftPrompt,
    );
    return session;
  });
}

/** Convert an empty chat session into a terminal session (irreversible). */
export async function convertSessionToTerminal(
  wsId: string,
  sessionId: string,
  dataDir = getDataDir(),
): Promise<SessionMetadata> {
  return withWorkspaceLock(wsId, async () => {
    const ctx = await resolveWorkspaceContext(wsId, dataDir);
    const session = await loadSessionFromDisk(ctx, sessionId, dataDir);
    session.convertToTerminal();
    await session.persistMetadata();
    return session.metadata;
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
    browserSessionManager.closeSession(wsId, sessionId);

    // Remove any terminal-tab PTY keyed by this session id: kill it if running
    // and always drop the registry entry (and its replay buffer) so a deleted
    // terminal's output can't linger or be replayed. No-op for chat sessions.
    removeTerminal(wsId, sessionId);

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

export async function markSessionRead(
  wsId: string,
  sessionId: string,
  throughCount: number,
  dataDir = getDataDir(),
): Promise<SessionMetadata> {
  return withWorkspaceLock(wsId, async () => {
    const loaded = getLoadedSessionById(wsId, sessionId);
    if (loaded) return loaded.markRead(throughCount);

    const ctx = await resolveWorkspaceContext(wsId, dataDir);
    const metaPath = join(ctx.sessionsRoot, sessionId, "metadata.json");
    return updateSessionMetadata(metaPath, (metadata) => {
      if (metadata.workspaceId !== wsId) {
        throw new NotFoundError(`Session ${sessionId} does not belong to workspace ${wsId}`);
      }
      if (!Number.isInteger(throughCount) || throughCount < 0) {
        throw new Error("throughCount must be a non-negative integer");
      }
      if (throughCount > metadata.assistantMessageCount) {
        throw new Error("throughCount cannot exceed assistantMessageCount");
      }
      return {
        ...metadata,
        readAssistantMessageCount: Math.max(
          metadata.readAssistantMessageCount,
          throughCount,
        ),
      };
    });
  });
}

/** Resolve the absolute path to a session attachment file. */
export async function resolveSessionAttachmentPath(
  wsId: string,
  sessionId: string,
  filename: string,
  dataDir = getDataDir(),
): Promise<string | null> {
  const result = await getWorkspace(wsId, dataDir);
  if (!result) return null;
  return join(dataDir, result.projectState.id, "sessions", sessionId, "attachments", filename);
}

/** Return session IDs currently streaming in a workspace. */
export function getStreamingSessionIds(wsId: string): string[] {
  return getLoadedSessions(wsId)
    .filter((s) => s.status === "streaming")
    .map((s) => s.sessionId);
}

/** Park all in-memory sessions and drain persist queues (for graceful shutdown). */
export async function stopAllSessions(): Promise<void> {
  const drains: Promise<void>[] = [];
  for (const sessions of loadedSessionsByWorkspace.values()) {
    for (const session of sessions.values()) {
      session.stop("park");
      drains.push(session.drain());
    }
  }
  await Promise.allSettled(drains);
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
