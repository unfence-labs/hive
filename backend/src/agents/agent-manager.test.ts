import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm } from "node:fs/promises";
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
  _clearActiveSessions,
} from "./agent-manager.js";
import { loadProject, saveProject } from "../state/state.js";

const CONV_CMD = { command: "bash" };

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
