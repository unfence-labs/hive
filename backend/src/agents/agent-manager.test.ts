import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir, createFixtureRepo } from "../utils/test-helpers.js";
import { createProject } from "../projects/project-manager.js";
import { createWorkspace } from "../workspaces/workspace-manager.js";
import {
  getOrCreateSession,
  getSession,
  getSessionById,
  sendMessage,
  stopStreaming,
  endSession,
  getSessionMetadata,
  listWorkspaceSessions,
  createNewSession,
  convertSessionToTerminal,
  activateSession,
  hardDeleteSession,
  getSpecificSessionMessages,
  getDefaultSessionId,
  stopAllSessions,
  _clearActiveSessions,
  setNotifier,
} from "./agent-manager.js";
import { MAX_SESSIONS_PER_WORKSPACE } from "./session-limits.js";
import { updateSessionMetadata } from "./session-metadata.js";
import { getUnreadSessions } from "./session-dispatch.js";
import { _clearAll as clearAllScripts } from "../services/script-runner.js";
import {
  _setTerminalForTests,
  getTerminalProcess,
  _clearAllTerminals,
} from "../services/terminal-runner.js";
import { loadProject, saveProject } from "../state/state.js";
import type { ChatMessage, SessionMetadata } from "../types.js";
import { Notifier } from "../notifications/notifier.js";
import type { NotificationEvent } from "../notifications/types.js";

const CONV_CMD = { command: "bash", systemPrompt: false as const };

let tempDir: string;
let dataDir: string;
let projectId: string;
let projectName: string;
let wsId: string;
let wsName: string;

class RecordingNotifier extends Notifier {
  readonly events: NotificationEvent[] = [];
  rejectCalls = false;

  constructor() {
    super([]);
  }

  override async notify(event: NotificationEvent): Promise<void> {
    this.events.push(event);
    if (this.rejectCalls) throw new Error("notify failed");
  }
}

beforeEach(async () => {
  tempDir = await createTempDir("hive-session-mgr-test-");
  dataDir = join(tempDir, "data");
  const fixtureDir = join(tempDir, "fixtures");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dataDir, { recursive: true });
  await mkdir(fixtureDir, { recursive: true });
  const fixtureRepoUrl = await createFixtureRepo(fixtureDir);
  const project = await createProject(fixtureRepoUrl, dataDir);
  projectId = project.id;
  projectName = project.name;
  const ws = await createWorkspace(projectId, dataDir);
  wsId = ws.id;
  wsName = ws.name;
});

afterEach(async () => {
  setNotifier(new Notifier([]));
  _clearActiveSessions();
  clearAllScripts();
  _clearAllTerminals();
  await new Promise((r) => setTimeout(r, 50));
  await rm(tempDir, { recursive: true, force: true });
});

async function writeSessionFixture(
  sessionId: string,
  workspaceId: string,
  options?: {
    metadata?: Partial<SessionMetadata>;
    messages?: Array<ChatMessage | string>;
  },
) {
  const sessionDir = join(dataDir, projectId, "sessions", sessionId);
  await mkdir(sessionDir, { recursive: true });

  const metadata: SessionMetadata = {
    sessionId,
    workspaceId,
    createdAt: "2026-02-11T00:00:00.000Z",
    updatedAt: "2026-02-11T00:00:01.000Z",
    assistantMessageCount: 0,
    readAssistantMessageCount: 0,
    ...options?.metadata,
  };

  await writeFile(join(sessionDir, "metadata.json"), JSON.stringify(metadata), "utf-8");

  if (options?.messages) {
    const content = options.messages
      .map((msg) => typeof msg === "string" ? msg : JSON.stringify(msg))
      .join("\n");
    await writeFile(
      join(sessionDir, "messages.jsonl"),
      content + (content ? "\n" : ""),
      "utf-8",
    );
  }
}

describe("getDefaultSessionId", () => {
  it("migrates legacy messageCount metadata to the eligible assistant count on disk", async () => {
    const sessionDir = join(dataDir, projectId, "sessions", "legacy-count");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, "metadata.json"), JSON.stringify({
      sessionId: "legacy-count",
      workspaceId: wsId,
      createdAt: "2026-02-11T00:00:00.000Z",
      updatedAt: "2026-02-11T00:00:01.000Z",
      messageCount: 4,
    }), "utf-8");
    const messages = [
      { id: "u1", sessionId: "legacy-count", role: "user", content: "hi 1", timestamp: "2026-02-11T00:00:00.000Z" },
      { id: "a1", sessionId: "legacy-count", role: "assistant", content: "reply 1", timestamp: "2026-02-11T00:00:01.000Z" },
      { id: "u2", sessionId: "legacy-count", role: "user", content: "hi 2", timestamp: "2026-02-11T00:00:02.000Z" },
      { id: "a2", sessionId: "legacy-count", role: "assistant", content: "", timestamp: "2026-02-11T00:00:03.000Z" },
      { id: "u3", sessionId: "legacy-count", role: "user", content: "hi 3", timestamp: "2026-02-11T00:00:04.000Z" },
      { id: "a3", sessionId: "legacy-count", role: "assistant", content: "reply 2", timestamp: "2026-02-11T00:00:05.000Z" },
      { id: "u4", sessionId: "legacy-count", role: "user", content: "hi 4", timestamp: "2026-02-11T00:00:06.000Z" },
    ];
    await writeFile(
      join(sessionDir, "messages.jsonl"),
      messages.map((m) => JSON.stringify(m)).join("\n") + "\n",
      "utf-8",
    );

    const sessions = await listWorkspaceSessions(wsId, dataDir);
    const session = sessions.find((s) => s.sessionId === "legacy-count");
    expect(session).toMatchObject({
      assistantMessageCount: 2,
      readAssistantMessageCount: 2,
    });
    const persisted = JSON.parse(
      await readFile(join(sessionDir, "metadata.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(persisted).not.toHaveProperty("messageCount");
    expect(persisted).toMatchObject({
      assistantMessageCount: 2,
      readAssistantMessageCount: 2,
    });

    const unread = await getUnreadSessions(wsId, dataDir);
    expect(unread.find((s) => s.sessionId === "legacy-count")).toBeUndefined();
  });

  it("migrates legacy messageCount metadata with no transcript to zero", async () => {
    const sessionDir = join(dataDir, projectId, "sessions", "legacy-count-no-transcript");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, "metadata.json"), JSON.stringify({
      sessionId: "legacy-count-no-transcript",
      workspaceId: wsId,
      createdAt: "2026-02-11T00:00:00.000Z",
      updatedAt: "2026-02-11T00:00:01.000Z",
      messageCount: 4,
    }), "utf-8");

    const sessions = await listWorkspaceSessions(wsId, dataDir);
    const session = sessions.find((s) => s.sessionId === "legacy-count-no-transcript");
    expect(session).toMatchObject({
      assistantMessageCount: 0,
      readAssistantMessageCount: 0,
    });
    const persisted = JSON.parse(
      await readFile(join(sessionDir, "metadata.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(persisted).not.toHaveProperty("messageCount");
    expect(persisted).toMatchObject({
      assistantMessageCount: 0,
      readAssistantMessageCount: 0,
    });
  });

  it("lets a client clear a badge after an undershoot-migrated session gets a new response", async () => {
    const sessionDir = join(dataDir, projectId, "sessions", "legacy-count-undershoot");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, "metadata.json"), JSON.stringify({
      sessionId: "legacy-count-undershoot",
      workspaceId: wsId,
      createdAt: "2026-02-11T00:00:00.000Z",
      updatedAt: "2026-02-11T00:00:01.000Z",
      messageCount: 4,
    }), "utf-8");
    const messages = [
      { id: "u1", sessionId: "legacy-count-undershoot", role: "user", content: "hi 1", timestamp: "2026-02-11T00:00:00.000Z" },
      { id: "a1", sessionId: "legacy-count-undershoot", role: "assistant", content: "reply 1", timestamp: "2026-02-11T00:00:01.000Z" },
      { id: "u2", sessionId: "legacy-count-undershoot", role: "user", content: "hi 2", timestamp: "2026-02-11T00:00:02.000Z" },
      { id: "a2", sessionId: "legacy-count-undershoot", role: "assistant", content: "", timestamp: "2026-02-11T00:00:03.000Z" },
      { id: "u3", sessionId: "legacy-count-undershoot", role: "user", content: "hi 3", timestamp: "2026-02-11T00:00:04.000Z" },
      { id: "a3", sessionId: "legacy-count-undershoot", role: "assistant", content: "reply 2", timestamp: "2026-02-11T00:00:05.000Z" },
      { id: "u4", sessionId: "legacy-count-undershoot", role: "user", content: "hi 4", timestamp: "2026-02-11T00:00:06.000Z" },
    ];
    await writeFile(
      join(sessionDir, "messages.jsonl"),
      messages.map((m) => JSON.stringify(m)).join("\n") + "\n",
      "utf-8",
    );

    // Trigger the migration: both counters become 2 (the eligible assistant count).
    await listWorkspaceSessions(wsId, dataDir);

    // Simulate one new counted assistant response landing after migration.
    await updateSessionMetadata(join(sessionDir, "metadata.json"), (metadata) => ({
      ...metadata,
      assistantMessageCount: 3,
    }));

    const unread = await getUnreadSessions(wsId, dataDir);
    expect(unread.find((s) => s.sessionId === "legacy-count-undershoot")).toEqual({
      sessionId: "legacy-count-undershoot",
      assistantMessageCount: 3,
      readAssistantMessageCount: 2,
    });
  });

  it("returns undefined when the workspace has no non-empty conversation", async () => {
    await writeSessionFixture("empty-1", wsId, { metadata: { assistantMessageCount: 0 } });
    expect(await getDefaultSessionId(wsId, dataDir)).toBeUndefined();
  });

  it("returns an empty session that owns a pending draft prompt", async () => {
    await writeSessionFixture("draft-session", wsId, {
      metadata: { assistantMessageCount: 0, draftPrompt: "Fix issue #42" },
    });

    expect(await getDefaultSessionId(wsId, dataDir)).toBe("draft-session");
  });

  it("skips a newer empty session and opens the most-recent non-empty chat", async () => {
    await writeSessionFixture("empty-new", wsId, {
      metadata: { assistantMessageCount: 0, updatedAt: "2026-02-20T00:00:00.000Z" },
    });
    await writeSessionFixture("has-msgs", wsId, {
      metadata: { assistantMessageCount: 1, updatedAt: "2026-02-10T00:00:00.000Z" },
      messages: [
        { id: "u1", sessionId: "has-msgs", role: "user", content: "hi", timestamp: "2026-02-10T00:00:00.000Z" },
        { id: "a1", sessionId: "has-msgs", role: "assistant", content: "yo", timestamp: "2026-02-10T00:00:01.000Z" },
      ],
    });
    expect(await getDefaultSessionId(wsId, dataDir)).toBe("has-msgs");
  });

  it("skips an active empty loaded session and opens the most-recent non-empty chat", async () => {
    const { session: emptyActive } = await getOrCreateSession(wsId, dataDir, CONV_CMD);
    expect(emptyActive.metadata.assistantMessageCount).toBe(0);

    await writeSessionFixture("has-msgs", wsId, {
      metadata: { assistantMessageCount: 1, updatedAt: "2026-02-10T00:00:00.000Z" },
      messages: [
        { id: "u1", sessionId: "has-msgs", role: "user", content: "hi", timestamp: "2026-02-10T00:00:00.000Z" },
        { id: "a1", sessionId: "has-msgs", role: "assistant", content: "yo", timestamp: "2026-02-10T00:00:01.000Z" },
      ],
    });

    expect(await getDefaultSessionId(wsId, dataDir)).toBe("has-msgs");
  });

  it("never returns a terminal session", async () => {
    await writeSessionFixture("term", wsId, {
      metadata: { assistantMessageCount: 5, kind: "terminal", updatedAt: "2026-02-20T00:00:00.000Z" },
    });
    await writeSessionFixture("chat", wsId, {
      metadata: { assistantMessageCount: 1, updatedAt: "2026-02-10T00:00:00.000Z" },
      messages: [{ id: "u1", sessionId: "chat", role: "user", content: "hi", timestamp: "2026-02-10T00:00:00.000Z" }],
    });
    expect(await getDefaultSessionId(wsId, dataDir)).toBe("chat");
  });
});

describe("getOrCreateSession", () => {
  it("creates a session and sets workspace to busy", async () => {
    const { session, created } = await getOrCreateSession(wsId, dataDir, CONV_CMD);

    expect(created).toBe(true);
    expect(session.sessionId).toBeTruthy();

    const state = await loadProject(projectId, dataDir);
    const ws = state!.workspaces.find((w) => w.id === wsId);
    expect(ws!.status).toBe("busy");
    expect(ws!.activeSessionId).toBe(session.sessionId);
  });

  it("returns existing session if already active", async () => {
    const { session: first } = await getOrCreateSession(wsId, dataDir, CONV_CMD);
    const { session: second, created } = await getOrCreateSession(wsId, dataDir, CONV_CMD);

    expect(created).toBe(false);
    expect(second).toBe(first);
  });

  it("throws for non-existent workspace", async () => {
    await expect(getOrCreateSession("nonexistent", dataDir, CONV_CMD)).rejects.toThrow("not found");
  });

  it("moves a pending draftPrompt into the new session", async () => {
    const state = await loadProject(projectId, dataDir);
    const ws = state!.workspaces.find((w) => w.id === wsId)!;
    ws.draftPrompt = "Fix the bug in #42";
    await saveProject(state!, dataDir);

    const { session } = await getOrCreateSession(wsId, dataDir, CONV_CMD);

    const after = await loadProject(projectId, dataDir);
    const afterWs = after!.workspaces.find((w) => w.id === wsId);
    expect(afterWs!.draftPrompt).toBeUndefined();
    expect(session.metadata.draftPrompt).toBe("Fix the bug in #42");

    const persisted = JSON.parse(
      await readFile(join(dataDir, projectId, "sessions", session.sessionId, "metadata.json"), "utf-8"),
    ) as SessionMetadata;
    expect(persisted.draftPrompt).toBe("Fix the bug in #42");
  });

  it("recovers stale busy workspace state and creates a new session", async () => {
    const state = await loadProject(projectId, dataDir);
    const ws = state!.workspaces.find((w) => w.id === wsId)!;
    ws.status = "busy";
    ws.activeSessionId = "stale-session-id";
    await saveProject(state!, dataDir);

    const { session, created } = await getOrCreateSession(wsId, dataDir, CONV_CMD);
    expect(created).toBe(true);
    expect(session.sessionId).toBeTruthy();

    const updatedState = await loadProject(projectId, dataDir);
    const updatedWs = updatedState!.workspaces.find((w) => w.id === wsId)!;
    expect(updatedWs.status).toBe("busy");
    expect(updatedWs.activeSessionId).toBe(session.sessionId);
  });

  it("resumes previous session from disk after server restart", async () => {
    // Simulate a session that was active before server restart:
    // session files exist on disk, workspace is persisted as busy.
    const claudeSessionId = "claude-uuid-for-resume";
    await writeSessionFixture("prev-session", wsId, {
      metadata: {
        claudeSessionId,
        assistantMessageCount: 5,
        readAssistantMessageCount: 5,
        updatedAt: "2026-02-12T00:00:00.000Z",
      },
    });

    const state = await loadProject(projectId, dataDir);
    const ws = state!.workspaces.find((w) => w.id === wsId)!;
    ws.status = "busy";
    ws.activeSessionId = "prev-session";
    await saveProject(state!, dataDir);

    // No in-memory session (simulates server restart)
    const { session, created } = await getOrCreateSession(wsId, dataDir, CONV_CMD);

    expect(created).toBe(false);
    expect(session.sessionId).toBe("prev-session");
    expect(session.metadata.claudeSessionId).toBe(claudeSessionId);
    expect(session.metadata.assistantMessageCount).toBe(5);

    const updatedState = await loadProject(projectId, dataDir);
    const updatedWs = updatedState!.workspaces.find((w) => w.id === wsId)!;
    expect(updatedWs.status).toBe("busy");
    expect(updatedWs.activeSessionId).toBe("prev-session");
  });

  it("falls back to new session when previous session belongs to different workspace", async () => {
    const otherWs = await createWorkspace(projectId, dataDir);
    await writeSessionFixture("other-ws-session", otherWs.id, {
      metadata: { updatedAt: "2026-02-12T00:00:00.000Z" },
    });

    const state = await loadProject(projectId, dataDir);
    const ws = state!.workspaces.find((w) => w.id === wsId)!;
    ws.status = "busy";
    ws.activeSessionId = "other-ws-session";
    await saveProject(state!, dataDir);

    const { session, created } = await getOrCreateSession(wsId, dataDir, CONV_CMD);

    expect(created).toBe(true);
    expect(session.sessionId).not.toBe("other-ws-session");
  });

  it("serializes concurrent creation attempts for the same workspace", async () => {
    const [first, second] = await Promise.all([
      getOrCreateSession(wsId, dataDir, CONV_CMD),
      getOrCreateSession(wsId, dataDir, CONV_CMD),
    ]);

    expect(first.session.sessionId).toBe(second.session.sessionId);
    expect([first.created, second.created].filter(Boolean)).toHaveLength(1);
  });

  it("never resumes a persisted terminal session as the active chat session", async () => {
    // A terminal session was persisted as the workspace's active session.
    // Resuming it as the active chat would render a shell over the chat UI and
    // silently no-op sendMessage, so a fresh chat session must be created.
    await writeSessionFixture("terminal-session", wsId, {
      metadata: { kind: "terminal", updatedAt: "2026-02-12T00:00:00.000Z" },
    });

    const state = await loadProject(projectId, dataDir);
    const ws = state!.workspaces.find((w) => w.id === wsId)!;
    ws.status = "busy";
    ws.activeSessionId = "terminal-session";
    await saveProject(state!, dataDir);

    const { session, created } = await getOrCreateSession(wsId, dataDir, CONV_CMD);

    expect(created).toBe(true);
    expect(session.sessionId).not.toBe("terminal-session");
    expect(session.metadata.kind).toBe("chat");

    const updatedState = await loadProject(projectId, dataDir);
    const updatedWs = updatedState!.workspaces.find((w) => w.id === wsId)!;
    expect(updatedWs.activeSessionId).toBe(session.sessionId);
  });
});

describe("getSession", () => {
  it("returns session for active workspace", async () => {
    await getOrCreateSession(wsId, dataDir, CONV_CMD);
    const session = getSession(wsId);
    expect(session).toBeDefined();
  });

  it("returns undefined for workspace without session", () => {
    const session = getSession(wsId);
    expect(session).toBeUndefined();
  });
});

describe("sendMessage", () => {
  it("auto-creates session and sends message", async () => {
    const session = await sendMessage(wsId, "Hello", dataDir, CONV_CMD);
    expect(session).toBeDefined();
    expect(session.status).toBe("streaming");
  });

  it("uses existing session for subsequent messages", async () => {
    await getOrCreateSession(wsId, dataDir, CONV_CMD);
    const session = await sendMessage(wsId, "Hello", dataDir, CONV_CMD);
    expect(session.status).toBe("streaming");
  });

  it("handles concurrent sends by allowing only one active stream", async () => {
    await getOrCreateSession(wsId, dataDir, CONV_CMD);

    const [first, second] = await Promise.allSettled([
      sendMessage(wsId, "first", dataDir, CONV_CMD),
      sendMessage(wsId, "second", dataDir, CONV_CMD),
    ]);

    const rejected = [first, second].filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    const fulfilled = [first, second].filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof sendMessage>>> =>
        r.status === "fulfilled",
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason)).toContain("Already streaming");
  });
});

describe("stopStreaming", () => {
  it("stops current process but keeps session alive", async () => {
    await sendMessage(wsId, "Hello", dataDir, CONV_CMD);

    stopStreaming(wsId);

    const session = getSession(wsId);
    expect(session).toBeDefined();
  });

  it("throws when no session exists", () => {
    expect(() => stopStreaming(wsId)).toThrow("No active session");
  });
});

describe("stopAllSessions", () => {
  it("parks all loaded sessions across workspaces", async () => {
    const otherWs = await createWorkspace(projectId, dataDir);
    const { session: sessionA } = await getOrCreateSession(wsId, dataDir, CONV_CMD);
    const { session: sessionB } = await getOrCreateSession(otherWs.id, dataDir, CONV_CMD);
    const stopA = vi.spyOn(sessionA, "stop");
    const stopB = vi.spyOn(sessionB, "stop");
    const drainA = vi.spyOn(sessionA, "drain");
    const drainB = vi.spyOn(sessionB, "drain");

    await stopAllSessions();

    expect(stopA).toHaveBeenCalledWith("park");
    expect(stopB).toHaveBeenCalledWith("park");
    expect(drainA).toHaveBeenCalledTimes(1);
    expect(drainB).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when no sessions are loaded", async () => {
    await expect(stopAllSessions()).resolves.toBeUndefined();
  });
});

describe("endSession", () => {
  it("terminates session and sets workspace back to idle", async () => {
    await getOrCreateSession(wsId, dataDir, CONV_CMD);
    await endSession(wsId, dataDir);

    expect(getSession(wsId)).toBeUndefined();

    const state = await loadProject(projectId, dataDir);
    const ws = state!.workspaces.find((w) => w.id === wsId);
    expect(ws!.status).toBe("idle");
    expect(ws!.activeSessionId).toBeUndefined();
  });

  it("allows creating a new session after ending one", async () => {
    await getOrCreateSession(wsId, dataDir, CONV_CMD);
    await endSession(wsId, dataDir);

    const { session, created } = await getOrCreateSession(wsId, dataDir, CONV_CMD);
    expect(created).toBe(true);
    expect(session.sessionId).toBeTruthy();
  });

  it("is idempotent when no session exists", async () => {
    await expect(endSession(wsId, dataDir)).resolves.toBeUndefined();

    const state = await loadProject(projectId, dataDir);
    const ws = state!.workspaces.find((w) => w.id === wsId);
    expect(ws!.status).toBe("idle");
  });

  it("leaves a draftPrompt untouched for an idle-only persist without a session", async () => {
    const state = await loadProject(projectId, dataDir);
    const ws = state!.workspaces.find((w) => w.id === wsId)!;
    ws.draftPrompt = "Fix the bug in #42";
    await saveProject(state!, dataDir);

    await endSession(wsId, dataDir);

    const after = await loadProject(projectId, dataDir);
    const afterWs = after!.workspaces.find((w) => w.id === wsId);
    expect(afterWs!.draftPrompt).toBe("Fix the bug in #42");
  });
});

describe("getSessionMetadata", () => {
  it("returns metadata for active session", async () => {
    await getOrCreateSession(wsId, dataDir, CONV_CMD);
    const meta = getSessionMetadata(wsId);
    expect(meta).not.toBeNull();
    expect(meta!.sessionId).toBeTruthy();
    expect(meta!.workspaceId).toBe(wsId);
  });

  it("returns null for workspace without session", () => {
    const meta = getSessionMetadata(wsId);
    expect(meta).toBeNull();
  });
});

describe("listWorkspaceSessions", () => {
  it("lists persisted sessions sorted by updatedAt and filters other workspaces", async () => {
    const otherWs = await createWorkspace(projectId, dataDir);
    await writeSessionFixture("sess-old", wsId, {
      metadata: { updatedAt: "2026-02-10T00:00:00.000Z" },
    });
    await writeSessionFixture("sess-new", wsId, {
      metadata: { updatedAt: "2026-02-12T00:00:00.000Z" },
    });
    await writeSessionFixture("sess-other", otherWs.id, {
      metadata: { updatedAt: "2099-01-01T00:00:00.000Z" },
    });

    const corruptDir = join(dataDir, projectId, "sessions", "sess-corrupt");
    await mkdir(corruptDir, { recursive: true });
    await writeFile(join(corruptDir, "metadata.json"), "{bad-json", "utf-8");

    const sessions = await listWorkspaceSessions(wsId, dataDir);
    expect(sessions.map((s) => s.sessionId)).toEqual(["sess-new", "sess-old"]);
  });

  it("enriches persisted metadata with active in-memory metadata", async () => {
    const { session } = await getOrCreateSession(wsId, dataDir, CONV_CMD);
    await writeSessionFixture(session.sessionId, wsId, {
      metadata: {
        updatedAt: "2000-01-01T00:00:00.000Z",
        assistantMessageCount: 99,
      },
    });

    const sessions = await listWorkspaceSessions(wsId, dataDir);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: session.sessionId,
      workspaceId: wsId,
      assistantMessageCount: session.metadata.assistantMessageCount,
      updatedAt: session.metadata.updatedAt,
    });
  });

  it("throws for non-existent workspace", async () => {
    await expect(listWorkspaceSessions("missing", dataDir)).rejects.toThrow("not found");
  });
});

describe("createNewSession", () => {
  it("keeps existing sessions loaded and activates the new one", async () => {
    const { session: first } = await getOrCreateSession(wsId, dataDir, CONV_CMD);
    const second = await createNewSession(wsId, dataDir, CONV_CMD);

    expect(second.sessionId).not.toBe(first.sessionId);
    expect(getSession(wsId)?.sessionId).toBe(second.sessionId);
    expect(getSessionById(wsId, first.sessionId)).toBeDefined();

    const state = await loadProject(projectId, dataDir);
    const ws = state!.workspaces.find((w) => w.id === wsId)!;
    expect(ws.status).toBe("busy");
    expect(ws.activeSessionId).toBe(second.sessionId);
  });

  it("throws for non-existent workspace", async () => {
    await expect(createNewSession("missing", dataDir, CONV_CMD)).rejects.toThrow("not found");
  });

  it("enforces the shared session cap (same rule as the Brain)", async () => {
    await getOrCreateSession(wsId, dataDir, CONV_CMD);
    for (let i = 1; i < MAX_SESSIONS_PER_WORKSPACE; i++) {
      await createNewSession(wsId, dataDir, CONV_CMD);
    }
    await expect(createNewSession(wsId, dataDir, CONV_CMD)).rejects.toThrow(/Maximum/);
  });

  it("supports concurrent streaming across two sessions in the same workspace", async () => {
    const fakeClaudePath = join(tempDir, "fake-claude-sleep.sh");
    await writeFile(fakeClaudePath, "#!/bin/sh\nsleep 5\n", "utf-8");
    await chmod(fakeClaudePath, 0o755);
    const slowCmd = { command: fakeClaudePath, systemPrompt: false as const };

    const { session: first } = await getOrCreateSession(wsId, dataDir, slowCmd);
    await sendMessage(wsId, "first", dataDir, slowCmd);
    expect(getSessionById(wsId, first.sessionId)?.status).toBe("streaming");

    const second = await createNewSession(wsId, dataDir, slowCmd);
    await sendMessage(wsId, "second", dataDir, slowCmd);

    expect(getSession(wsId)?.sessionId).toBe(second.sessionId);
    expect(getSessionById(wsId, first.sessionId)?.status).toBe("streaming");
    expect(getSessionById(wsId, second.sessionId)?.status).toBe("streaming");
  });
});

describe("terminal sessions", () => {
  it("does not consume a workspace draft prompt", async () => {
    const state = await loadProject(projectId, dataDir);
    state!.workspaces.find((w) => w.id === wsId)!.draftPrompt = "Fix issue #42";
    await saveProject(state!, dataDir);

    const session = await createNewSession(wsId, dataDir, CONV_CMD, "terminal");

    expect(session.metadata.draftPrompt).toBeUndefined();
    const after = await loadProject(projectId, dataDir);
    expect(after!.workspaces.find((w) => w.id === wsId)!.draftPrompt).toBe("Fix issue #42");
  });

  it("excludes terminal sessions from the conversation cap", async () => {
    // Fill the cap with chat sessions.
    await getOrCreateSession(wsId, dataDir, CONV_CMD);
    for (let i = 1; i < MAX_SESSIONS_PER_WORKSPACE; i++) {
      await createNewSession(wsId, dataDir, CONV_CMD);
    }
    // A terminal can still be opened despite the chat cap being full…
    await expect(
      createNewSession(wsId, dataDir, CONV_CMD, "terminal"),
    ).resolves.toBeDefined();
    // …and it did not consume a chat slot — another chat still rejects.
    await expect(createNewSession(wsId, dataDir, CONV_CMD)).rejects.toThrow(/Maximum/);
  });

  it("persists kind:terminal in metadata.json and lists it", async () => {
    const session = await createNewSession(wsId, dataDir, CONV_CMD, "terminal");
    expect(session.metadata.kind).toBe("terminal");

    const metaPath = join(dataDir, projectId, "sessions", session.sessionId, "metadata.json");
    const persisted = JSON.parse(await readFile(metaPath, "utf-8")) as SessionMetadata;
    expect(persisted.kind).toBe("terminal");

    const sessions = await listWorkspaceSessions(wsId, dataDir);
    const listed = sessions.find((s) => s.sessionId === session.sessionId);
    expect(listed?.kind).toBe("terminal");
  });

  it("defaults to chat kind when none is requested", async () => {
    const session = await createNewSession(wsId, dataDir, CONV_CMD);
    expect(session.metadata.kind).toBe("chat");
  });

  it("treats sendMessage on a terminal session as a no-op (no runner)", async () => {
    const session = await createNewSession(wsId, dataDir, CONV_CMD, "terminal");

    // Use a real (non-test) command path so a runner would be spawned for a
    // chat session, proving the terminal guard short-circuits before that.
    session.sendMessage("hello");

    expect(session.status).toBe("idle");
    const messages = await session.getMessages();
    expect(messages).toEqual([]);
  });

  it("hardDeleteSession kills the terminal PTY keyed by the session id", async () => {
    const session = await createNewSession(wsId, dataDir, CONV_CMD, "terminal");

    // Seed a fake running terminal PTY keyed by the session id, as
    // terminal-tabs/start would.
    _setTerminalForTests(wsId, session.sessionId);
    expect(getTerminalProcess(wsId, session.sessionId)?.state).toBe("running");

    // stopTerminal() arms a 5s SIGKILL fallback timer on the (fake) PTY. Fake
    // timers keep that callback from ever firing process.kill during the test.
    vi.useFakeTimers();
    try {
      await hardDeleteSession(wsId, session.sessionId, dataDir);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }

    expect(getTerminalProcess(wsId, session.sessionId)).toBeUndefined();
  });

  it("converts an empty chat session into a terminal session in place", async () => {
    const { session } = await getOrCreateSession(wsId, dataDir, CONV_CMD);
    expect(session.metadata.kind).toBe("chat");

    const meta = await convertSessionToTerminal(wsId, session.sessionId, dataDir);
    expect(meta.kind).toBe("terminal");
    // Same in-memory instance is mutated (not a fork).
    expect(session.metadata.kind).toBe("terminal");

    const metaPath = join(dataDir, projectId, "sessions", session.sessionId, "metadata.json");
    const persisted = JSON.parse(await readFile(metaPath, "utf-8")) as SessionMetadata;
    expect(persisted.kind).toBe("terminal");
  });

  it("refuses to convert a session that already has messages", async () => {
    await writeSessionFixture("chatty-session", wsId, {
      metadata: { assistantMessageCount: 3, updatedAt: "2026-02-12T00:00:00.000Z" },
    });

    await expect(
      convertSessionToTerminal(wsId, "chatty-session", dataDir),
    ).rejects.toThrow(/messages/);
  });
});

describe("activateSession", () => {
  it("loads a persisted session, marks it active, and keeps current loaded", async () => {
    const { session: current } = await getOrCreateSession(wsId, dataDir, CONV_CMD);
    await writeSessionFixture("sess-target", wsId, {
      metadata: { assistantMessageCount: 2, updatedAt: "2026-02-12T00:00:00.000Z" },
    });

    const activated = await activateSession(wsId, "sess-target", dataDir, CONV_CMD);

    expect(activated.sessionId).toBe("sess-target");
    expect(getSession(wsId)?.sessionId).toBe("sess-target");
    expect(getSessionById(wsId, current.sessionId)).toBeDefined();

    const state = await loadProject(projectId, dataDir);
    const ws = state!.workspaces.find((w) => w.id === wsId)!;
    expect(ws.status).toBe("busy");
    expect(ws.activeSessionId).toBe("sess-target");
  });

  it("returns the same session when activating the already active session id", async () => {
    const { session } = await getOrCreateSession(wsId, dataDir, CONV_CMD);
    const result = await activateSession(wsId, session.sessionId, dataDir, CONV_CMD);
    expect(result).toBe(session);
  });

  it("throws when target session is missing", async () => {
    await expect(activateSession(wsId, "missing-session", dataDir, CONV_CMD)).rejects.toThrow("not found");
  });

  it("throws when session belongs to another workspace", async () => {
    const otherWs = await createWorkspace(projectId, dataDir);
    await writeSessionFixture("sess-other", otherWs.id);
    await expect(activateSession(wsId, "sess-other", dataDir, CONV_CMD)).rejects.toThrow("does not belong");
  });
});

describe("hardDeleteSession", () => {
  it("deletes an inactive session from disk and keeps current active session", async () => {
    const { session: active } = await getOrCreateSession(wsId, dataDir, CONV_CMD);
    await writeSessionFixture("sess-delete", wsId);
    const deletePath = join(dataDir, projectId, "sessions", "sess-delete");

    await hardDeleteSession(wsId, "sess-delete", dataDir);

    await expect(stat(deletePath)).rejects.toThrow();
    expect(getSession(wsId)?.sessionId).toBe(active.sessionId);

    const state = await loadProject(projectId, dataDir);
    const ws = state!.workspaces.find((w) => w.id === wsId)!;
    expect(ws.status).toBe("busy");
    expect(ws.activeSessionId).toBe(active.sessionId);
  });

  it("deletes the active session and resets workspace to idle", async () => {
    const { session } = await getOrCreateSession(wsId, dataDir, CONV_CMD);
    await hardDeleteSession(wsId, session.sessionId, dataDir);

    expect(getSession(wsId)).toBeUndefined();

    const state = await loadProject(projectId, dataDir);
    const ws = state!.workspaces.find((w) => w.id === wsId)!;
    expect(ws.status).toBe("idle");
    expect(ws.activeSessionId).toBeUndefined();
  });

  it("removes session directory from disk after deleting active session", async () => {
    const { session } = await getOrCreateSession(wsId, dataDir, CONV_CMD);
    const sessionDir = join(dataDir, projectId, "sessions", session.sessionId);

    // Write fixture files so the session dir exists on disk
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, "metadata.json"), JSON.stringify({
      sessionId: session.sessionId,
      workspaceId: wsId,
      createdAt: "2026-02-12T00:00:00.000Z",
      updatedAt: "2026-02-12T00:00:01.000Z",
      assistantMessageCount: 0,
      readAssistantMessageCount: 0,
    }), "utf-8");

    await expect(stat(sessionDir)).resolves.toBeDefined();

    await hardDeleteSession(wsId, session.sessionId, dataDir);

    // Directory must be gone
    await expect(stat(sessionDir)).rejects.toThrow();
  });

  it("does not throw when deleting a session with no files on disk", async () => {
    // Use rm with force: true — deleting a non-existent session should not throw
    await expect(
      hardDeleteSession(wsId, "nonexistent-session-id", dataDir),
    ).resolves.toBeUndefined();
  });

  it("allows creating a new session after hard deleting the active one", async () => {
    const { session } = await getOrCreateSession(wsId, dataDir, CONV_CMD);
    await hardDeleteSession(wsId, session.sessionId, dataDir);

    const { session: newSession, created } = await getOrCreateSession(wsId, dataDir, CONV_CMD);
    expect(created).toBe(true);
    expect(newSession.sessionId).not.toBe(session.sessionId);

    const state = await loadProject(projectId, dataDir);
    const ws = state!.workspaces.find((w) => w.id === wsId)!;
    expect(ws.status).toBe("busy");
    expect(ws.activeSessionId).toBe(newSession.sessionId);
  });

  it("serializes concurrent hard-deletes for the same workspace", async () => {
    await writeSessionFixture("sess-a", wsId);
    await writeSessionFixture("sess-b", wsId);

    await Promise.all([
      hardDeleteSession(wsId, "sess-a", dataDir),
      hardDeleteSession(wsId, "sess-b", dataDir),
    ]);

    const sessions = await listWorkspaceSessions(wsId, dataDir);
    expect(sessions).toEqual([]);
  });
});

describe("getSpecificSessionMessages", () => {
  it("returns messages from active in-memory session when session id matches", async () => {
    const { session } = await getOrCreateSession(wsId, dataDir, CONV_CMD);
    const messages = await getSpecificSessionMessages(wsId, session.sessionId, dataDir);
    expect(messages).toEqual([]);
  });

  it("reads and parses persisted messages for a specific session", async () => {
    await writeSessionFixture("sess-disk", wsId, {
      messages: [
        {
          id: "m-1",
          sessionId: "sess-disk",
          role: "user",
          content: "from disk",
          timestamp: "2026-02-12T00:00:00.000Z",
        },
        "not-json-line",
        {
          id: "m-2",
          sessionId: "sess-disk",
          role: "assistant",
          content: "reply",
          timestamp: "2026-02-12T00:00:01.000Z",
        },
      ],
    });

    const messages = await getSpecificSessionMessages(wsId, "sess-disk", dataDir);
    expect(messages).toEqual([
      expect.objectContaining({ id: "m-1", content: "from disk", role: "user" }),
      expect.objectContaining({ id: "m-2", content: "reply", role: "assistant" }),
    ]);
  });

  it("returns empty array when persisted messages do not exist", async () => {
    const messages = await getSpecificSessionMessages(wsId, "missing", dataDir);
    expect(messages).toEqual([]);
  });

  it("throws for non-existent workspace", async () => {
    await expect(getSpecificSessionMessages("missing", "sess-1", dataDir)).rejects.toThrow("not found");
  });
});

describe("notifications", () => {
  it("notifies when an active session emits done", async () => {
    const notifier = new RecordingNotifier();
    setNotifier(notifier);
    const { session } = await getOrCreateSession(wsId, dataDir, CONV_CMD);

    session.emit("message", {
      type: "done",
      sessionId: session.sessionId,
      durationMs: 2400,
    });

    await vi.waitFor(() => {
      expect(notifier.events).toEqual([
        {
          type: "agent_turn_complete",
          workspaceId: wsId,
          workspaceName: wsName,
          projectName,
          sessionId: session.sessionId,
          durationMs: 2400,
        },
      ]);
    });
  });

  it("does not notify for non-done websocket messages", async () => {
    const notifier = new RecordingNotifier();
    setNotifier(notifier);
    const { session } = await getOrCreateSession(wsId, dataDir, CONV_CMD);

    session.emit("message", {
      type: "text_delta",
      sessionId: session.sessionId,
      text: "chunk",
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(notifier.events).toEqual([]);
  });

  it("attaches notifications to sessions resumed from disk", async () => {
    const notifier = new RecordingNotifier();
    setNotifier(notifier);

    await writeSessionFixture("persisted-session", wsId, {
      metadata: {
        updatedAt: "2026-02-12T00:00:00.000Z",
      },
    });

    const state = await loadProject(projectId, dataDir);
    const ws = state!.workspaces.find((w) => w.id === wsId)!;
    ws.status = "busy";
    ws.activeSessionId = "persisted-session";
    await saveProject(state!, dataDir);

    const { session, created } = await getOrCreateSession(wsId, dataDir, CONV_CMD);
    expect(created).toBe(false);
    expect(session.sessionId).toBe("persisted-session");

    session.emit("message", {
      type: "done",
      sessionId: session.sessionId,
    });

    await vi.waitFor(() => {
      expect(notifier.events).toHaveLength(1);
      expect(notifier.events[0]).toMatchObject({
        type: "agent_turn_complete",
        workspaceId: wsId,
        sessionId: "persisted-session",
      });
    });
  });

  it("swallows notifier errors", async () => {
    const notifier = new RecordingNotifier();
    notifier.rejectCalls = true;
    setNotifier(notifier);
    const { session } = await getOrCreateSession(wsId, dataDir, CONV_CMD);

    expect(() => {
      session.emit("message", {
        type: "done",
        sessionId: session.sessionId,
      });
    }).not.toThrow();

    await vi.waitFor(() => {
      expect(notifier.events).toHaveLength(1);
    });
  });
});
