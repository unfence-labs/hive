import { join } from "node:path";
import { readdir, readFile, rm } from "node:fs/promises";
import { ConversationSession } from "./conversation-session.js";
import { buildPrompt, loadBrainPrompt } from "./system-prompt.js";
import { getDataDir } from "../state/state.js";
import { BRAIN_WORKSPACE_ID, brainDir, brainRepoPath } from "../utils/paths.js";
import { requireBrainRepo } from "../brain/brain-files.js";
import { buildFileTree, flattenFilePaths } from "../utils/file-tree.js";
import { NotFoundError } from "../utils/errors.js";
import { getNotifier } from "./agent-manager.js";
import { assertSessionCapacity } from "./session-limits.js";
import { extractSummary, extractPreview } from "../utils/summary-extractor.js";
import { withKeyedLock } from "../utils/async-lock.js";
import { parseJsonlMessages, sortByUpdatedAtDesc } from "./session-utils.js";
import type { ChatMessage, SessionMetadata } from "../types.js";

/**
 * Brain session manager.
 *
 * The Brain is a singleton normal Git clone (not a Project/Workspace), so it
 * cannot reuse {@link import("./agent-manager.js")} — that module is hardwired
 * to the workspace model (workspace lookup, project-state persistence, branch
 * naming, browser env). This manager reuses the same {@link ConversationSession}
 * machinery (lifecycle, persistence, provider lock, WS events) but resolves its
 * context from the Brain repo instead.
 *
 * All Brain sessions share a single logical workspace id, {@link BRAIN_WORKSPACE_ID},
 * so the existing WS hub and frontend transport address them unchanged.
 */
export { BRAIN_WORKSPACE_ID };


/** Max wait for a deleted session's process to exit before releasing the lock (ms). */
const EXIT_AWAIT_TIMEOUT_MS = 6000;

const loadedSessions = new Map<string, ConversationSession>();
let activeSessionId: string | undefined;
/** Single-key lock map serializing Brain session state mutations. */
const brainLocks = new Map<string, Promise<void>>();

function sessionsRoot(dataDir: string): string {
  return join(brainDir(dataDir), "sessions");
}

function getActiveSession(): ConversationSession | undefined {
  return activeSessionId ? loadedSessions.get(activeSessionId) : undefined;
}

function getMostRecentlyUpdatedLoadedSession(): ConversationSession | undefined {
  const sessions = Array.from(loadedSessions.values());
  if (sessions.length === 0) return undefined;
  const sorted = sortByUpdatedAtDesc(sessions.map((s) => s.metadata));
  return sorted[0] ? loadedSessions.get(sorted[0].sessionId) : undefined;
}

/**
 * Build the Brain system prompt with a fresh file-path map.
 *
 * The map is refreshed at session creation (first turn) and on every disk load,
 * so a session that resumes after the Brain changes sees the current structure.
 * Within a single in-memory session the prompt is sent only on the first message
 * (Claude `--append-system-prompt`), matching workspace behavior.
 */
async function buildBrainPrompt(dataDir: string): Promise<string> {
  const repoPath = brainRepoPath(dataDir);
  let filePaths: string[] = [];
  try {
    filePaths = flattenFilePaths(await buildFileTree(repoPath));
  } catch {
    // Empty/unreadable Brain — prompt still describes the role.
  }
  const basePrompt = await loadBrainPrompt(join(dataDir, "prompts"));
  return buildPrompt("brain", {
    base: basePrompt,
    interpolation: { projectName: "Brain", cwd: repoPath, defaultBranch: "main" },
    brainFilePaths: filePaths,
  }).text;
}

function attachNotificationListener(session: ConversationSession): void {
  const n = getNotifier();
  if (!n) return;
  const baseCtx = {
    workspaceId: BRAIN_WORKSPACE_ID,
    workspaceName: "Brain",
    projectName: "Brain",
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
          n.notify({ type: "agent_turn_complete", ...baseCtx, durationMs: msg.durationMs, summary }).catch(() => {});
        })();
      }
    } else if (msg.type === "cancelled" && !msg.userInitiated) {
      n.notify({ type: "agent_failed", ...baseCtx, durationMs: msg.durationMs, errorDetail: msg.errorDetail }).catch(() => {});
    }
  });
}

interface CreateOptions {
  command?: string;
}

async function createSession(dataDir: string, options?: CreateOptions): Promise<ConversationSession> {
  const systemPrompt = options?.command ? undefined : await buildBrainPrompt(dataDir);
  const session = new ConversationSession({
    cwd: brainRepoPath(dataDir),
    dataDir: brainDir(dataDir),
    workspaceId: BRAIN_WORKSPACE_ID,
    command: options?.command,
    systemPrompt,
    sessionKind: "brain",
  });
  await session.persistMetadata();
  attachNotificationListener(session);
  loadedSessions.set(session.sessionId, session);
  return session;
}

async function loadSessionFromDisk(
  sessionId: string,
  dataDir: string,
  options?: CreateOptions,
): Promise<ConversationSession> {
  const loaded = loadedSessions.get(sessionId);
  if (loaded) return loaded;

  const metaPath = join(sessionsRoot(dataDir), sessionId, "metadata.json");
  let meta: SessionMetadata;
  try {
    const raw = await readFile(metaPath, "utf-8");
    meta = JSON.parse(raw) as SessionMetadata;
  } catch {
    throw new NotFoundError(`Session ${sessionId} not found`);
  }
  if (meta.workspaceId !== BRAIN_WORKSPACE_ID) {
    throw new NotFoundError(`Session ${sessionId} does not belong to the Brain`);
  }

  const systemPrompt = options?.command ? undefined : await buildBrainPrompt(dataDir);
  const session = await ConversationSession.load({
    sessionId,
    cwd: brainRepoPath(dataDir),
    dataDir: brainDir(dataDir),
    workspaceId: BRAIN_WORKSPACE_ID,
    command: options?.command,
    systemPrompt,
    sessionKind: "brain",
  });
  attachNotificationListener(session);
  loadedSessions.set(sessionId, session);
  return session;
}

/**
 * Get or create the active Brain session. Asserts the Brain exists (409 when
 * absent, via {@link requireBrainRepo}).
 */
export async function getOrCreateBrainSession(
  dataDir = getDataDir(),
  options?: CreateOptions,
): Promise<{ session: ConversationSession; created: boolean }> {
  return withKeyedLock(brainLocks, BRAIN_WORKSPACE_ID, async () => {
    await requireBrainRepo(dataDir);

    const existing = getActiveSession();
    if (existing) return { session: existing, created: false };

    const fallback = getMostRecentlyUpdatedLoadedSession();
    if (fallback) {
      activeSessionId = fallback.sessionId;
      return { session: fallback, created: false };
    }

    const session = await createSession(dataDir, options);
    activeSessionId = session.sessionId;
    return { session, created: true };
  });
}

/** Get the active in-memory Brain session, if any. */
export function getBrainSession(): ConversationSession | undefined {
  return getActiveSession();
}

/** Get a specific loaded Brain session, if present in memory. */
export function getBrainSessionById(sessionId: string): ConversationSession | undefined {
  return loadedSessions.get(sessionId);
}

/** Session IDs currently streaming in the Brain. */
export function getStreamingBrainSessionIds(): string[] {
  return Array.from(loadedSessions.values())
    .filter((s) => s.status === "streaming")
    .map((s) => s.sessionId);
}

/** Stop the streaming process for a Brain session (keeps it loaded). */
export function stopBrainStreaming(sessionId?: string): void {
  const session = sessionId ? loadedSessions.get(sessionId) : getActiveSession();
  if (!session) throw new Error("No active Brain session");
  session.stop();
}

/** List all Brain sessions (persisted + in-memory), newest first. */
export async function listBrainSessions(dataDir = getDataDir()): Promise<SessionMetadata[]> {
  await requireBrainRepo(dataDir);
  const sessions: SessionMetadata[] = [];

  try {
    const entries = await readdir(sessionsRoot(dataDir), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const raw = await readFile(join(sessionsRoot(dataDir), entry.name, "metadata.json"), "utf-8");
        const meta = JSON.parse(raw) as SessionMetadata;
        if (meta.workspaceId !== BRAIN_WORKSPACE_ID) continue;
        sessions.push(meta);
      } catch {
        // Skip unreadable/corrupt metadata.
      }
    }
  } catch {
    // No sessions directory yet.
  }

  for (const loaded of loadedSessions.values()) {
    const idx = sessions.findIndex((s) => s.sessionId === loaded.sessionId);
    if (idx >= 0) sessions[idx] = loaded.metadata;
    else sessions.push(loaded.metadata);
  }

  return sortByUpdatedAtDesc(sessions);
}

/** Create a new Brain session and make it active. Enforces the shared session cap. */
export async function createNewBrainSession(
  dataDir = getDataDir(),
  options?: CreateOptions,
): Promise<ConversationSession> {
  return withKeyedLock(brainLocks, BRAIN_WORKSPACE_ID, async () => {
    await requireBrainRepo(dataDir);
    const existing = await listBrainSessions(dataDir);
    assertSessionCapacity(existing.length, "Brain sessions");
    const session = await createSession(dataDir, options);
    activeSessionId = session.sessionId;
    return session;
  });
}

/** Activate an existing Brain session from disk without stopping others. */
export async function activateBrainSession(
  sessionId: string,
  dataDir = getDataDir(),
  options?: CreateOptions,
): Promise<ConversationSession> {
  return withKeyedLock(brainLocks, BRAIN_WORKSPACE_ID, async () => {
    await requireBrainRepo(dataDir);
    const active = getActiveSession();
    if (active?.sessionId === sessionId) return active;
    const session = await loadSessionFromDisk(sessionId, dataDir, options);
    activeSessionId = sessionId;
    return session;
  });
}

/** Load messages for the active Brain session (or the most recent on disk). */
export async function getBrainSessionMessages(dataDir = getDataDir()): Promise<ChatMessage[]> {
  const active = getActiveSession();
  if (active) return active.getMessages();
  const loaded = getMostRecentlyUpdatedLoadedSession();
  if (loaded) return loaded.getMessages();

  const metas = await listBrainSessions(dataDir);
  for (const meta of metas) {
    const messagesPath = join(sessionsRoot(dataDir), meta.sessionId, "messages.jsonl");
    try {
      return parseJsonlMessages(await readFile(messagesPath, "utf-8"));
    } catch {
      // Try next candidate.
    }
  }
  return [];
}

/** Load messages for a specific Brain session (memory first, then disk). */
export async function getSpecificBrainSessionMessages(
  sessionId: string,
  dataDir = getDataDir(),
): Promise<ChatMessage[]> {
  const loaded = loadedSessions.get(sessionId);
  if (loaded) return loaded.getMessages();
  const messagesPath = join(sessionsRoot(dataDir), sessionId, "messages.jsonl");
  try {
    return parseJsonlMessages(await readFile(messagesPath, "utf-8"));
  } catch {
    return [];
  }
}

/** Hard-delete a Brain session: stop if loaded, remove its files from disk. */
export async function hardDeleteBrainSession(
  sessionId: string,
  dataDir = getDataDir(),
): Promise<void> {
  await withKeyedLock(brainLocks, BRAIN_WORKSPACE_ID, async () => {
    const loaded = loadedSessions.get(sessionId);
    const wasActive = activeSessionId === sessionId;

    if (loaded) {
      loadedSessions.delete(sessionId);
      if (wasActive) activeSessionId = undefined;
      // Wait for the process to exit, but never hold the lock forever: if a
      // wedged runner never emits "exit", fall through after a timeout (just
      // above the runner's SIGKILL grace) so Brain session ops can't deadlock.
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(done, EXIT_AWAIT_TIMEOUT_MS);
        loaded.once("exit", done);
        loaded.stop("park");
      });
    }

    await rm(join(sessionsRoot(dataDir), sessionId), { recursive: true, force: true });

    if (wasActive) {
      const next = getMostRecentlyUpdatedLoadedSession();
      activeSessionId = next?.sessionId;
    }
  });
}

/** Resolve the absolute path to a Brain session attachment file. */
export function resolveBrainSessionAttachmentPath(
  sessionId: string,
  filename: string,
  dataDir = getDataDir(),
): string {
  return join(sessionsRoot(dataDir), sessionId, "attachments", filename);
}

// ── Test helpers ────────────────────────────────────────────────────

/** For testing: stop and clear all in-memory Brain sessions. */
export function _clearBrainSessions(): void {
  for (const session of loadedSessions.values()) {
    session.stop("park");
  }
  loadedSessions.clear();
  activeSessionId = undefined;
  brainLocks.clear();
}
