import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir, createFixtureRepo } from "../utils/test-helpers.js";
import { createProject } from "../projects/project-manager.js";
import { createWorkspace } from "../workspaces/workspace-manager.js";
import {
  getOrCreateSession,
  getSession,
  sendMessage,
  stopStreaming,
  endSession,
  getSessionMetadata,
  listWorkspaceSessions,
  createNewSession,
  activateSession,
  hardDeleteSession,
  getSpecificSessionMessages,
  _clearActiveSessions,
} from "./agent-manager.js";
import { loadProject, saveProject } from "../state/state.js";
import type { ChatMessage, SessionMetadata } from "../types.js";

const CONV_CMD = { command: "bash", systemPrompt: false as const };

let tempDir: string;
let dataDir: string;
let projectId: string;
let wsId: string;

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
  const ws = await createWorkspace(projectId, dataDir);
  wsId = ws.id;
});

afterEach(async () => {
  _clearActiveSessions();
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
    messageCount: 0,
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

  it("serializes concurrent creation attempts for the same workspace", async () => {
    const [first, second] = await Promise.all([
      getOrCreateSession(wsId, dataDir, CONV_CMD),
      getOrCreateSession(wsId, dataDir, CONV_CMD),
    ]);

    expect(first.session.sessionId).toBe(second.session.sessionId);
    expect([first.created, second.created].filter(Boolean)).toHaveLength(1);
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
        messageCount: 99,
      },
    });

    const sessions = await listWorkspaceSessions(wsId, dataDir);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: session.sessionId,
      workspaceId: wsId,
      messageCount: session.metadata.messageCount,
      updatedAt: session.metadata.updatedAt,
    });
  });

  it("throws for non-existent workspace", async () => {
    await expect(listWorkspaceSessions("missing", dataDir)).rejects.toThrow("not found");
  });
});

describe("createNewSession", () => {
  it("parks the current session and activates a new one", async () => {
    const { session: first } = await getOrCreateSession(wsId, dataDir, CONV_CMD);
    const second = await createNewSession(wsId, dataDir, CONV_CMD);

    expect(second.sessionId).not.toBe(first.sessionId);
    expect(getSession(wsId)?.sessionId).toBe(second.sessionId);
    expect(first.status).not.toBe("streaming");

    const state = await loadProject(projectId, dataDir);
    const ws = state!.workspaces.find((w) => w.id === wsId)!;
    expect(ws.status).toBe("busy");
    expect(ws.activeSessionId).toBe(second.sessionId);
  });

  it("throws for non-existent workspace", async () => {
    await expect(createNewSession("missing", dataDir, CONV_CMD)).rejects.toThrow("not found");
  });
});

describe("activateSession", () => {
  it("loads a persisted session and marks it active", async () => {
    const { session: current } = await getOrCreateSession(wsId, dataDir, CONV_CMD);
    await writeSessionFixture("sess-target", wsId, {
      metadata: { messageCount: 2, updatedAt: "2026-02-12T00:00:00.000Z" },
    });

    const activated = await activateSession(wsId, "sess-target", dataDir, CONV_CMD);

    expect(activated.sessionId).toBe("sess-target");
    expect(getSession(wsId)?.sessionId).toBe("sess-target");
    expect(current.status).not.toBe("streaming");

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
