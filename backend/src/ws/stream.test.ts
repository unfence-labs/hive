import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import WebSocket from "ws";
import { createHash } from "node:crypto";
import { chmod, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir, createFixtureRepo } from "../utils/test-helpers.js";
import { createProject } from "../projects/project-manager.js";
import { createWorkspace } from "../workspaces/workspace-manager.js";
import {
  getSession,
  getOrCreateSession,
  getSessionById,
  createNewSession,
  convertSessionToTerminal,
  sendMessage,
  hardDeleteSession,
  endSession,
  _clearActiveSessions,
} from "../agents/agent-manager.js";
import type { SessionOptions } from "../agents/agent-manager.js";
import type { AuthExpectation } from "../utils/auth.js";
import { streamRoutes, broadcastToWorkspace, completionProviderForMessage, _getChannelsForTests, _getHubSocketsForTests, _tickHubLivenessForTests } from "./stream.js";
import {
  _setScriptStatusForTests,
  _clearAll as clearScripts,
} from "../services/script-runner.js";
import type { WsOutgoing, HubOutgoing, DiffStatResponse, BranchInfo } from "../types.js";

/** Hub envelope carrying a workspace event (excludes hub-level pong frames). */
type WorkspaceEnvelope = Extract<HubOutgoing, { workspaceId: string }>;

const CONV_CMD = { command: "bash" };

let tempDir: string;
let dataDir: string;
let app: FastifyInstance;
let projectId: string;
let wsId: string;

beforeEach(async () => {
  tempDir = await createTempDir("hive-ws-stream-test-");
  dataDir = join(tempDir, "data");
  const fixtureDir = join(tempDir, "fixtures");
  await mkdir(dataDir, { recursive: true });
  await mkdir(fixtureDir, { recursive: true });
  const fixtureRepoUrl = await createFixtureRepo(fixtureDir);

  const project = await createProject(fixtureRepoUrl, dataDir);
  projectId = project.id;
  const workspace = await createWorkspace(projectId, dataDir);
  wsId = workspace.id;

  app = Fastify();
  await app.register(websocket, { options: { maxPayload: 10 * 1024 * 1024 } });
  await app.register((instance: FastifyInstance) =>
    streamRoutes(instance, { dataDir, sessionOptions: CONV_CMD }),
  );
  await app.ready();
});

afterEach(async () => {
  clearScripts();
  _clearActiveSessions();
  await new Promise((r) => setTimeout(r, 100));
  await app.close();
  await rm(tempDir, { recursive: true, force: true });
});

// ── Hub connection helpers ──────────────────────────────────────────

/** Wrap a WsIncoming as a hub envelope message. */
function hubEvent(workspaceId: string, event: object): string {
  return JSON.stringify({ workspaceId, event });
}

/** Send sync_workspaces via a hub WebSocket. */
function syncWorkspaces(
  ws: WebSocket,
  workspaceIds: string[],
  focusWorkspaces?: string[],
  prWorkspaces?: string[],
  forceBootstrap?: boolean,
): void {
  ws.send(JSON.stringify({
    type: "sync_workspaces",
    workspaceIds,
    ...(focusWorkspaces !== undefined ? { focusWorkspaces } : {}),
    ...(prWorkspaces !== undefined ? { prWorkspaces } : {}),
    ...(forceBootstrap !== undefined ? { forceBootstrap } : {}),
  }));
}

/**
 * Connect to the hub WS and subscribe to workspace(s).
 * Messages are unwrapped from HubOutgoing envelopes for easy assertions.
 * Returns messages filtered to the target workspace by default.
 */
function connectHub(
  workspaceIds: string[],
  opts?: {
    app?: FastifyInstance;
    headers?: Record<string, string>;
    query?: Record<string, string>;
    /** If set, collect ALL workspace messages (unfiltered). Default: first workspace. */
    collectAll?: boolean;
    /** Restrict high-frequency events to these workspaces (C13). */
    focusWorkspaces?: string[];
    /** Request PR status for these workspaces. */
    prWorkspaces?: string[];
  },
): {
  wsReady: Promise<WebSocket>;
  messages: WsOutgoing[];
  allEnvelopes: WorkspaceEnvelope[];
} {
  const queryString = opts?.query
    ? `?${new URLSearchParams(opts.query).toString()}`
    : "";
  const path = `/ws/hub${queryString}`;
  const messages: WsOutgoing[] = [];
  const allEnvelopes: WorkspaceEnvelope[] = [];
  const targetWsId = workspaceIds[0];
  const wsReady = (opts?.app ?? app).injectWS(
    path,
    { headers: opts?.headers },
    {
      onInit: (ws) => {
        ws.on("message", (data: Buffer) => {
          const envelope = JSON.parse(data.toString()) as HubOutgoing;
          if (!("workspaceId" in envelope)) return; // ignore hub-level pong frames
          allEnvelopes.push(envelope);
          if (opts?.collectAll || envelope.workspaceId === targetWsId) {
            messages.push(envelope.event);
          }
        });
        // Subscribe to workspaces after the connection is established
        ws.on("open", () => {
          syncWorkspaces(ws, workspaceIds, opts?.focusWorkspaces, opts?.prWorkspaces);
        });
      },
    },
  ) as Promise<WebSocket>;
  return { wsReady, messages, allEnvelopes };
}

/** Connect to hub and attach listeners after injectWS resolves. */
async function connectHubLateListener(
  workspaceIds: string[],
  opts?: {
    app?: FastifyInstance;
    headers?: Record<string, string>;
    query?: Record<string, string>;
  },
): Promise<{ ws: WebSocket; messages: WsOutgoing[]; allEnvelopes: HubOutgoing[] }> {
  const queryString = opts?.query
    ? `?${new URLSearchParams(opts.query).toString()}`
    : "";
  const path = `/ws/hub${queryString}`;
  const ws = (await (opts?.app ?? app).injectWS(path, { headers: opts?.headers })) as WebSocket;
  const messages: WsOutgoing[] = [];
  const allEnvelopes: WorkspaceEnvelope[] = [];
  const targetWsId = workspaceIds[0];

  // Simulate clients that install message handlers right after websocket init.
  await Promise.resolve();
  ws.on("message", (data: Buffer) => {
    const envelope = JSON.parse(data.toString()) as HubOutgoing;
    if (!("workspaceId" in envelope)) return; // ignore hub-level pong frames
    allEnvelopes.push(envelope);
    if (envelope.workspaceId === targetWsId) {
      messages.push(envelope.event);
    }
  });

  // Subscribe after listener is attached
  syncWorkspaces(ws, workspaceIds);

  return { ws, messages, allEnvelopes };
}

async function startWsApp(
  auth?: AuthExpectation,
  sessionOptions: SessionOptions = CONV_CMD,
  gitSyncSnapshotProvider?: {
    getCachedBranchInfo: (
      workspaceId: string,
    ) => Extract<WsOutgoing, { type: "branch_info" }>["info"] | undefined;
    getCachedDiffStats: (
      workspaceId: string,
    ) => Extract<WsOutgoing, { type: "diff_stats" }>["stats"] | undefined;
  },
  prStatusProvider?: {
    getCachedStatus: (
      workspaceId: string,
    ) => Extract<WsOutgoing, { type: "pr_status" }>["status"] | undefined;
    getStatus: (
      workspaceId: string,
    ) => Promise<Extract<WsOutgoing, { type: "pr_status" }>["status"]>;
  },
): Promise<{ app: FastifyInstance }> {
  const localApp = Fastify();
  await localApp.register(websocket, { options: { maxPayload: 10 * 1024 * 1024 } });
  await localApp.register((instance: FastifyInstance) =>
    streamRoutes(instance, {
      dataDir,
      sessionOptions,
      auth,
      gitSyncSnapshotProvider,
      prStatusProvider,
    }),
  );
  await localApp.ready();
  return { app: localApp };
}

/** Wait until a condition is met on the collected messages. */
function waitForMessage(
  messages: WsOutgoing[],
  predicate: (msgs: WsOutgoing[]) => boolean,
  timeoutMs = 3000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      if (predicate(messages)) {
        clearInterval(interval);
        clearTimeout(timeout);
        resolve();
      }
    }, 20);
    const timeout = setTimeout(() => {
      clearInterval(interval);
      reject(new Error(`Timeout waiting for message. Got: ${JSON.stringify(messages)}`));
    }, timeoutMs);
  });
}

/** Wait until an arbitrary condition is met. */
function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      if (predicate()) {
        clearInterval(interval);
        clearTimeout(timeout);
        resolve();
      }
    }, 20);
    const timeout = setTimeout(() => {
      clearInterval(interval);
      reject(new Error("Timeout waiting for condition"));
    }, timeoutMs);
  });
}

async function writePersistedChatSession(
  sessionId: string,
  content: string,
  updatedAt = "2026-02-10T00:00:01.000Z",
): Promise<void> {
  const sessionDir = join(dataDir, projectId, "sessions", sessionId);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    join(sessionDir, "metadata.json"),
    JSON.stringify({
      sessionId,
      workspaceId: wsId,
      createdAt: "2026-02-10T00:00:00.000Z",
      updatedAt,
      messageCount: 1,
    }),
    "utf-8",
  );
  await writeFile(
    join(sessionDir, "messages.jsonl"),
    JSON.stringify({
      id: "m-1",
      sessionId,
      role: "assistant",
      content,
      timestamp: "2026-02-10T00:00:00.000Z",
    }) + "\n",
    "utf-8",
  );
}

describe("WS /ws/hub", () => {
  it("sends idle status when no session exists", async () => {
    const { wsReady, messages } = connectHub([wsId]);
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.length >= 1);

    expect(messages[0]).toEqual({ type: "status", status: "idle", streaming: false });
    ws.close();
  });

  it("delivers bootstrap status when listener is attached after injectWS resolves", async () => {
    const { ws, messages } = await connectHubLateListener([wsId]);

    await waitForMessage(messages, (msgs) => msgs.some((m) => m.type === "status"));

    expect(messages[0]).toEqual({ type: "status", status: "idle", streaming: false });
    ws.close();
  });

  it("redirects to the default non-empty chat via status only when the active loaded session is empty", async () => {
    const { session: emptyActive } = await getOrCreateSession(wsId, dataDir, CONV_CMD);
    const defaultSessionId = "sess-default-non-empty";
    await writePersistedChatSession(defaultSessionId, "persisted default response");

    const { wsReady, messages } = connectHub([wsId]);
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.some((m) => m.type === "status"));
    // Give a (mistaken) history frame a chance to arrive before asserting absence.
    await new Promise((r) => setTimeout(r, 50));

    const status = messages.find((m) => m.type === "status");
    expect(status).toEqual({
      type: "status",
      status: "idle",
      streaming: false,
      sessionId: defaultSessionId,
    });
    expect(status).not.toEqual(expect.objectContaining({ sessionId: emptyActive.sessionId }));

    // History is REST-owned: the backend never ships a WS `history` frame at bootstrap.
    expect(messages.some((m) => m.type === "history")).toBe(false);

    ws.close();
    await endSession(wsId, dataDir);
  });

  it("bootstraps the default non-empty chat when the active loaded session is terminal", async () => {
    const { session: terminalActive } = await getOrCreateSession(wsId, dataDir, CONV_CMD);
    await convertSessionToTerminal(wsId, terminalActive.sessionId, dataDir);
    const defaultSessionId = "sess-default-after-terminal";
    await writePersistedChatSession(defaultSessionId, "persisted chat after terminal");

    const { wsReady, messages } = connectHub([wsId]);
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.some((m) => m.type === "status"));

    const status = messages.find((m) => m.type === "status");
    expect(status).toEqual({
      type: "status",
      status: "idle",
      streaming: false,
      sessionId: defaultSessionId,
    });
    expect(status).not.toEqual(expect.objectContaining({ sessionId: terminalActive.sessionId }));

    ws.close();
    await endSession(wsId, dataDir);
  });

  it("bootstraps a streaming default session as busy (never idle) when the active session is empty", async () => {
    const fakeClaudePath = join(tempDir, "fake-claude-stream-default.sh");
    await writeFile(fakeClaudePath, "#!/bin/sh\nsleep 5\n", "utf-8");
    await chmod(fakeClaudePath, 0o755);
    const slowCmd = { command: fakeClaudePath, systemPrompt: false as const };
    const local = await startWsApp(undefined, slowCmd);

    // A streaming session, then a fresh empty active session layered on top.
    const streaming = await createNewSession(wsId, dataDir, slowCmd);
    streaming.sendMessage("keep me streaming");
    await waitForCondition(() => streaming.status === "streaming");
    const emptyActive = await createNewSession(wsId, dataDir, slowCmd);
    expect(emptyActive.metadata.messageCount).toBe(0);

    const { wsReady, messages } = connectHub([wsId], { app: local.app });
    const ws = await wsReady;

    await waitForMessage(
      messages,
      (msgs) =>
        msgs.some(
          (m) => m.type === "status" && m.sessionId === streaming.sessionId && m.streaming === true,
        ),
    );
    // Let any (mistaken) idle status for the streaming default arrive.
    await new Promise((r) => setTimeout(r, 50));

    const defaultStatuses = messages.filter(
      (m) => m.type === "status" && m.sessionId === streaming.sessionId,
    );
    expect(defaultStatuses.length).toBeGreaterThan(0);
    for (const m of defaultStatuses) {
      if (m.type === "status") {
        expect(m.status).toBe("busy");
        expect(m.streaming).toBe(true);
      }
    }

    ws.close();
    await local.app.close();
    await endSession(wsId, dataDir).catch(() => {});
  });

  it("sends idle status when session exists but is not streaming", async () => {
    await getOrCreateSession(wsId, dataDir, CONV_CMD);

    const { wsReady, messages } = connectHub([wsId]);
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.length >= 1);

    expect(messages[0].type).toBe("status");
    if (messages[0].type === "status") {
      expect(messages[0].status).toBe("idle");
      expect(messages[0].sessionId).toBeTruthy();
      expect(messages[0].streaming).toBe(false);
    }

    ws.close();
    await endSession(wsId, dataDir);
  });

  it("includes streamingStartedAt in bootstrap status when session is already streaming", async () => {
    const fakeClaudePath = join(tempDir, "fake-claude-bootstrap.sh");
    await writeFile(fakeClaudePath, "#!/bin/sh\nsleep 5\n", "utf-8");
    await chmod(fakeClaudePath, 0o755);
    const slowCmd = { command: fakeClaudePath, systemPrompt: false as const };
    const local = await startWsApp(undefined, slowCmd);

    const { session } = await getOrCreateSession(wsId, dataDir, slowCmd);
    session.sendMessage("bootstrap busy");

    const { wsReady, messages } = connectHub([wsId], { app: local.app });
    const ws = await wsReady;

    await waitForMessage(
      messages,
      (msgs) =>
        msgs.some(
          (m) =>
            m.type === "status" &&
            m.status === "busy" &&
            m.streaming === true &&
            m.sessionId === session.sessionId,
        ),
    );

    const busy = messages.find(
      (m) =>
        m.type === "status" &&
        m.status === "busy" &&
        m.streaming === true &&
        m.sessionId === session.sessionId,
    );
    expect(busy?.type).toBe("status");
    if (!busy || busy.type !== "status") {
      throw new Error("Expected a busy status for bootstrap");
    }
    expect(typeof busy.streamingStartedAt).toBe("number");
    expect(busy.streamingStartedAt).toBe(session.streamingStartedAt ?? undefined);

    ws.close();
    await local.app.close();
    await endSession(wsId, dataDir).catch(() => {});
  });

  it("replays streaming snapshot during bootstrap", async () => {
    const fakeClaudePath = join(tempDir, "fake-claude-activity-bootstrap.sh");
    await writeFile(fakeClaudePath, "#!/bin/sh\nsleep 5\n", "utf-8");
    await chmod(fakeClaudePath, 0o755);
    const slowCmd = { command: fakeClaudePath, systemPrompt: false as const };
    const local = await startWsApp(undefined, slowCmd);

    const { session } = await getOrCreateSession(wsId, dataDir, slowCmd);
    session.sendMessage("bootstrap activity");
    const snapshot = session.getStreamingSnapshot();
    if (!snapshot) throw new Error("Expected a streaming snapshot");
    vi.spyOn(session, "getStreamingSnapshot").mockReturnValue({
      ...snapshot,
      reasoningSegments: [{
        id: "reasoning:provider-item-1:0",
        headline: "Inspecting state",
      }],
      agentActivities: [{
        id: "cmd-bootstrap",
        kind: "command_execution",
        command: "npm test",
        status: "inProgress",
        output: "running\n",
      }],
    });

    const { wsReady, messages } = connectHub([wsId], { app: local.app });
    const ws = await wsReady;

    await waitForMessage(
      messages,
      (msgs) =>
        msgs.some(
          (m) =>
            m.type === "stream_snapshot" &&
            m.agentActivities.some((activity) => activity.id === "cmd-bootstrap"),
        ),
    );

    expect(messages).toContainEqual({
      type: "stream_snapshot",
      sessionId: session.sessionId,
      text: snapshot.text,
      reasoningSegments: [{
        id: "reasoning:provider-item-1:0",
        headline: "Inspecting state",
      }],
      toolCalls: snapshot.toolCalls,
      agentActivities: [{
        id: "cmd-bootstrap",
        kind: "command_execution",
        command: "npm test",
        status: "inProgress",
        output: "running\n",
      }],
      agentPlanMode: snapshot.agentPlanMode,
      streamingStartedAt: session.streamingStartedAt ?? undefined,
    });

    ws.close();
    await local.app.close();
    await endSession(wsId, dataDir).catch(() => {});
  });

  it("replays snapshots and attaches listeners for non-active streaming sessions during bootstrap", async () => {
    const fakeClaudePath = join(tempDir, "fake-claude-multi-bootstrap.sh");
    await writeFile(fakeClaudePath, "#!/bin/sh\nsleep 5\n", "utf-8");
    await chmod(fakeClaudePath, 0o755);
    const slowCmd = { command: fakeClaudePath, systemPrompt: false as const };
    const local = await startWsApp(undefined, slowCmd);

    const { session: first } = await getOrCreateSession(wsId, dataDir, slowCmd);
    first.sendMessage("first session");
    const firstSnapshot = first.getStreamingSnapshot();
    if (!firstSnapshot) throw new Error("Expected first streaming snapshot");
    vi.spyOn(first, "getStreamingSnapshot").mockReturnValue({
      ...firstSnapshot,
      text: "first snapshot",
    });

    const second = await createNewSession(wsId, dataDir, slowCmd);
    second.sendMessage("second session");
    const secondSnapshot = second.getStreamingSnapshot();
    if (!secondSnapshot) throw new Error("Expected second streaming snapshot");
    vi.spyOn(second, "getStreamingSnapshot").mockReturnValue({
      ...secondSnapshot,
      text: "second snapshot",
    });

    const { wsReady, messages } = connectHub([wsId], { app: local.app });
    const ws = await wsReady;

    await waitForMessage(
      messages,
      (msgs) =>
        msgs.some(
          (m) =>
            m.type === "stream_snapshot" &&
            m.sessionId === first.sessionId &&
            m.text === "first snapshot",
        ) &&
        msgs.some(
          (m) =>
            m.type === "stream_snapshot" &&
            m.sessionId === second.sessionId &&
            m.text === "second snapshot",
        ),
    );

    const marker = messages.length;
    first.emit("message", { type: "text_delta", sessionId: first.sessionId, text: " later" });

    await waitForMessage(
      messages,
      (msgs) =>
        msgs.slice(marker).some(
          (m) => m.type === "text_delta" && m.sessionId === first.sessionId && m.text === " later",
        ),
    );

    ws.close();
    await local.app.close();
    await endSession(wsId, dataDir).catch(() => {});
  });

  it("auto-creates session on user_message", async () => {
    const { wsReady, messages } = connectHub([wsId]);
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.length >= 1); // initial status

    ws.send(hubEvent(wsId, { type: "user_message", content: "Hello" }));

    await waitForMessage(
      messages,
      (msgs) => msgs.some((m) => m.type === "status" && "sessionId" in m && m.sessionId),
    ).catch(() => {});

    const statusMsgs = messages.filter(
      (m) => m.type === "status" && "sessionId" in m && m.sessionId,
    );
    expect(statusMsgs.length).toBeGreaterThanOrEqual(1);
    expect(
      statusMsgs.some((m) => m.type === "status" && m.streaming === true),
    ).toBe(true);

    ws.close();
    await endSession(wsId, dataDir).catch(() => {});
  });

  it("authorizes a user_message that races the subscribe bootstrap on the same socket", async () => {
    // Regression: a workspace event sent immediately after sync_workspaces, on
    // the same socket, must not be rejected as "Not subscribed" just because the
    // async bootstrap has not finished. Subscription intent is recorded before
    // the bootstrap await, so the racing message is authorized.
    const ws = (await app.injectWS("/ws/hub")) as WebSocket;
    const messages: WsOutgoing[] = [];
    ws.on("message", (data: Buffer) => {
      const envelope = JSON.parse(data.toString()) as HubOutgoing;
      if (!("workspaceId" in envelope)) return;
      if (envelope.workspaceId === wsId) messages.push(envelope.event);
    });

    // Subscribe and immediately fire a workspace event, back to back, so the
    // event frame arrives while sendWorkspaceBootstrap is still awaiting.
    syncWorkspaces(ws, [wsId]);
    ws.send(hubEvent(wsId, { type: "user_message", content: "race" }));

    await waitForMessage(
      messages,
      (msgs) => msgs.some((m) => m.type === "status" && m.streaming === true),
    );

    expect(
      messages.some(
        (m) => m.type === "error" && m.message.includes("Not subscribed"),
      ),
    ).toBe(false);

    ws.close();
    await endSession(wsId, dataDir).catch(() => {});
  });

  it("returns an error when user_message targets a deleted session id", async () => {
    const { session } = await getOrCreateSession(wsId, dataDir, CONV_CMD);
    const deletedSessionId = session.sessionId;

    const { wsReady, messages } = connectHub([wsId]);
    const ws = await wsReady;

    await waitForMessage(
      messages,
      (msgs) =>
        msgs.some(
          (m) => m.type === "status" && m.sessionId === deletedSessionId,
        ),
    );

    await hardDeleteSession(wsId, deletedSessionId, dataDir);

    const marker = messages.length;
    ws.send(hubEvent(wsId, {
      type: "user_message",
      content: "should fail",
      sessionId: deletedSessionId,
      clientMessageId: "local-rejected-1",
    }));

    await waitForMessage(
      messages,
      (msgs) =>
        msgs.some(
          (m) =>
            m.type === "error" &&
            m.message.includes(`Session ${deletedSessionId} not found`),
        ),
    );

    expect(getSessionById(wsId, deletedSessionId)).toBeUndefined();
    const errorEvent = messages.find(
      (message) => message.type === "error" && message.message.includes(`Session ${deletedSessionId} not found`),
    );
    expect(errorEvent).toMatchObject({
      type: "error",
      sessionId: deletedSessionId,
      clientMessageId: "local-rejected-1",
    });
    const busyForDeleted = messages
      .slice(marker)
      .some(
        (m) =>
          m.type === "status" &&
          m.status === "busy" &&
          m.sessionId === deletedSessionId,
      );
    expect(busyForDeleted).toBe(false);

    ws.close();
  });

  it("returns an error when tool_input_response targets a deleted session id", async () => {
    const { session } = await getOrCreateSession(wsId, dataDir, CONV_CMD);
    const deletedSessionId = session.sessionId;

    const { wsReady, messages } = connectHub([wsId]);
    const ws = await wsReady;

    await waitForMessage(
      messages,
      (msgs) =>
        msgs.some(
          (m) => m.type === "status" && m.sessionId === deletedSessionId,
        ),
    );

    await hardDeleteSession(wsId, deletedSessionId, dataDir);

    const marker = messages.length;
    ws.send(hubEvent(wsId, {
      type: "tool_input_response",
      requestId: "req-missing-session",
      toolName: "ExitPlanMode",
      result: { type: "dismiss", message: "dismiss should fail" },
      sessionId: deletedSessionId,
    }));

    await waitForMessage(
      messages,
      (msgs) =>
        msgs.some(
          (m) =>
            m.type === "error" &&
            m.message.includes(`Session ${deletedSessionId} not found`),
        ),
    );

    expect(getSessionById(wsId, deletedSessionId)).toBeUndefined();
    const busyForDeleted = messages
      .slice(marker)
      .some(
        (m) =>
          m.type === "status" &&
          m.status === "busy" &&
          m.sessionId === deletedSessionId,
      );
    expect(busyForDeleted).toBe(false);

    ws.close();
  });

  it("accepts user_message options and keeps stream status busy", async () => {
    const { wsReady, messages } = connectHub([wsId]);
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.length >= 1);

    ws.send(hubEvent(wsId, {
      type: "user_message",
      content: "Hello with options",
      options: { planMode: true, thinkingLevel: "low" },
    }));

    await waitForMessage(
      messages,
      (msgs) => msgs.some((m) => m.type === "status" && m.status === "busy" && m.streaming === true),
    );

    const busy = [...messages].reverse().find(
      (m) => m.type === "status" && m.status === "busy" && m.streaming === true,
    );
    expect(busy?.type).toBe("status");
    if (!busy || busy.type !== "status") {
      throw new Error("Expected busy status after user_message with options");
    }
    expect(typeof busy.streamingStartedAt).toBe("number");

    ws.close();
    await endSession(wsId, dataDir).catch(() => {});
  });

  it("switches sessions without interrupting an already streaming session", async () => {
    const fakeClaudePath = join(tempDir, "fake-claude-sleep.sh");
    await writeFile(fakeClaudePath, "#!/bin/sh\nsleep 5\n", "utf-8");
    await chmod(fakeClaudePath, 0o755);
    const slowCmd = { command: fakeClaudePath, systemPrompt: false as const };

    const local = await startWsApp(undefined, slowCmd);
    const { wsReady, messages } = connectHub([wsId], { app: local.app });
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.length >= 1);

    ws.send(hubEvent(wsId, { type: "user_message", content: "first in session A" }));
    await waitForMessage(
      messages,
      (msgs) => msgs.some(
        (m) =>
          m.type === "status" &&
          m.status === "busy" &&
          m.streaming === true &&
          typeof m.sessionId === "string",
      ),
    );

    const firstBusy = [...messages].reverse().find(
      (m) =>
        m.type === "status" &&
        m.status === "busy" &&
        m.streaming === true &&
        typeof m.sessionId === "string",
    );
    expect(firstBusy?.type).toBe("status");
    if (!firstBusy || firstBusy.type !== "status" || !firstBusy.sessionId) {
      throw new Error("Expected first streaming status with session id");
    }
    const firstSessionId = firstBusy.sessionId;

    const secondSession = await createNewSession(wsId, dataDir, slowCmd);
    ws.send(hubEvent(wsId, { type: "switch_session", sessionId: secondSession.sessionId }));
    await waitForMessage(
      messages,
      (msgs) =>
        msgs.some(
          (m) =>
            m.type === "status" &&
            (m.status === "busy" || m.status === "idle") &&
            m.sessionId === secondSession.sessionId,
        ),
    );

    ws.send(hubEvent(wsId, {
      type: "user_message",
      content: "second in session B",
      sessionId: secondSession.sessionId,
    }));
    await waitForMessage(
      messages,
      (msgs) =>
        msgs.some(
          (m) =>
            m.type === "status" &&
            m.status === "busy" &&
            m.sessionId === secondSession.sessionId &&
            m.streaming === true,
        ),
    );

    expect(getSessionById(wsId, firstSessionId)?.status).toBe("streaming");
    expect(getSessionById(wsId, secondSession.sessionId)?.status).toBe("streaming");

    ws.close();
    await local.app.close();
    await endSession(wsId, dataDir).catch(() => {});
  });

  it("accepts tool_input_response and keeps stream status busy", async () => {
    const { wsReady, messages } = connectHub([wsId]);
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.length >= 1);

    ws.send(hubEvent(wsId, {
      type: "tool_input_response",
      requestId: "req-1",
      toolName: "ExitPlanMode",
      result: { type: "approve" },
    }));

    await waitForMessage(
      messages,
      (msgs) => msgs.some((m) => m.type === "status" && m.status === "busy" && m.streaming === true),
    );

    const busy = [...messages].reverse().find(
      (m) => m.type === "status" && m.status === "busy" && m.streaming === true,
    );
    expect(busy?.type).toBe("status");
    if (!busy || busy.type !== "status") {
      throw new Error("Expected busy status after tool input response");
    }
    expect(typeof busy.streamingStartedAt).toBe("number");
    expect(messages.some((m) => m.type === "tool_input_resolved")).toBe(true);

    ws.close();
    await endSession(wsId, dataDir).catch(() => {});
  });

  it("routes dismiss responses to the originating session after handoff", async () => {
    const { session: oldSession } = await getOrCreateSession(wsId, dataDir, CONV_CMD);
    const oldRespondSpy = vi.spyOn(oldSession, "respondToToolInput");

    const { wsReady, messages } = connectHub([wsId]);
    const ws = await wsReady;

    await waitForMessage(
      messages,
      (msgs) => msgs.some((m) => m.type === "status" && typeof m.sessionId === "string"),
    );

    oldSession.emit("message", {
      type: "tool_input_required",
      sessionId: oldSession.sessionId,
      requestId: "req-dismiss",
      toolName: "ExitPlanMode",
      toolUseId: "toolu-plan",
      input: { plan: "Plan A" },
    });

    await waitForMessage(
      messages,
      (msgs) =>
        msgs.some(
          (m) =>
            m.type === "tool_input_required" &&
            m.requestId === "req-dismiss" &&
            m.toolName === "ExitPlanMode",
        ),
    );

    const newSession = await createNewSession(wsId, dataDir, CONV_CMD);
    const newRespondSpy = vi.spyOn(newSession, "respondToToolInput");

    ws.send(hubEvent(wsId, {
      type: "tool_input_response",
      requestId: "req-dismiss",
      toolName: "ExitPlanMode",
      result: { type: "dismiss", message: "Plan handed off to a new session." },
      sessionId: oldSession.sessionId,
    }));

    await waitForMessage(
      messages,
      (msgs) =>
        msgs.some(
          (m) => m.type === "tool_input_resolved" && m.sessionId === oldSession.sessionId,
        ),
    );

    expect(oldRespondSpy).toHaveBeenCalledWith(
      "ExitPlanMode",
      { type: "dismiss", message: "Plan handed off to a new session." },
    );
    expect(newRespondSpy).not.toHaveBeenCalled();

    ws.close();
    await endSession(wsId, dataDir).catch(() => {});
  });

  it("broadcasts user_message event to all connected hub clients", async () => {
    const first = connectHub([wsId]);
    const second = connectHub([wsId]);
    const ws1 = await first.wsReady;
    const ws2 = await second.wsReady;

    await waitForMessage(first.messages, (msgs) => msgs.length >= 1);
    await waitForMessage(second.messages, (msgs) => msgs.length >= 1);

    ws1.send(hubEvent(wsId, { type: "user_message", content: "cross-client-sync", clientMessageId: "local-xyz789" }));

    await waitForMessage(
      first.messages,
      (msgs) => msgs.some((m) => m.type === "user_message"),
    );
    await waitForMessage(
      second.messages,
      (msgs) => msgs.some((m) => m.type === "user_message"),
    );

    const firstUserEvent = first.messages.find((m) => m.type === "user_message");
    const secondUserEvent = second.messages.find((m) => m.type === "user_message");

    expect(firstUserEvent).toBeDefined();
    expect(secondUserEvent).toBeDefined();
    if (firstUserEvent?.type === "user_message") {
      expect(firstUserEvent.message.role).toBe("user");
      expect(firstUserEvent.message.content).toBe("cross-client-sync");
      expect(firstUserEvent.message.clientMessageId).toBe("local-xyz789");
    }
    if (secondUserEvent?.type === "user_message") {
      expect(secondUserEvent.message.role).toBe("user");
      expect(secondUserEvent.message.content).toBe("cross-client-sync");
      expect(secondUserEvent.message.clientMessageId).toBe("local-xyz789");
    }

    ws1.close();
    ws2.close();
    await endSession(wsId, dataDir).catch(() => {});
  });

  it("handles invalid JSON from client", async () => {
    await getOrCreateSession(wsId, dataDir, CONV_CMD);
    const { wsReady, allEnvelopes } = connectHub([wsId]);
    const ws = await wsReady;

    await waitForCondition(() => allEnvelopes.length >= 1);

    ws.send("not json at all");

    await waitForCondition(() =>
      allEnvelopes.some((e) => e.event.type === "error"),
    );

    const errorEnvelope = allEnvelopes.find((e) => e.event.type === "error");
    expect(errorEnvelope).toBeDefined();
    if (errorEnvelope?.event.type === "error") {
      expect(errorEnvelope.event.message).toContain("Invalid JSON");
    }

    ws.close();
    await endSession(wsId, dataDir);
  });

  it("replies pong to an application-level ping", async () => {
    await getOrCreateSession(wsId, dataDir, CONV_CMD);
    const { wsReady } = connectHub([wsId]);
    const ws = await wsReady;

    const raw: string[] = [];
    ws.on("message", (data: Buffer) => raw.push(data.toString()));

    ws.send(JSON.stringify({ type: "ping" }));

    const isPong = (s: string): boolean => {
      try { return (JSON.parse(s) as { type?: string }).type === "pong"; } catch { return false; }
    };
    await waitForCondition(() => raw.some(isPong));
    expect(raw.some(isPong)).toBe(true);

    ws.close();
    await endSession(wsId, dataDir);
  });

  it("never sends a WS history frame at bootstrap for a loaded non-streaming session", async () => {
    await getOrCreateSession(wsId, dataDir, CONV_CMD);

    const received: WsOutgoing[] = [];
    const ws = (await app.injectWS("/ws/hub", {}, {
      onInit: (clientWs: WebSocket) => {
        clientWs.on("message", (data: Buffer) => {
          const env = JSON.parse(data.toString()) as HubOutgoing;
          if ("workspaceId" in env && env.workspaceId === wsId) received.push(env.event);
        });
        clientWs.on("open", () => {
          clientWs.send(JSON.stringify({ type: "sync_workspaces", workspaceIds: [wsId] }));
        });
      },
    })) as WebSocket;

    await waitForCondition(() => received.some((m) => m.type === "status"));
    await new Promise((r) => setTimeout(r, 150));

    expect(received.some((m) => m.type === "status")).toBe(true);
    expect(received.some((m) => m.type === "history")).toBe(false);

    ws.close();
    await endSession(wsId, dataDir);
  });

  it("handles stop command without error", async () => {
    await getOrCreateSession(wsId, dataDir, CONV_CMD);
    const { wsReady, messages } = connectHub([wsId]);
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.length >= 1);

    ws.send(hubEvent(wsId, { type: "stop" }));

    await new Promise((r) => setTimeout(r, 100));

    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
    await endSession(wsId, dataDir);
  });

  it("broadcasts session events to multiple connected clients", async () => {
    await getOrCreateSession(wsId, dataDir, CONV_CMD);

    const first = connectHub([wsId]);
    const second = connectHub([wsId]);
    const ws1 = await first.wsReady;
    const ws2 = await second.wsReady;

    await waitForMessage(first.messages, (msgs) => msgs.length >= 1);
    await waitForMessage(second.messages, (msgs) => msgs.length >= 1);

    const firstCount = first.messages.length;
    const secondCount = second.messages.length;

    await sendMessage(wsId, "Hello from test", dataDir, CONV_CMD);

    await waitForMessage(first.messages, (msgs) => msgs.length > firstCount);
    await waitForMessage(second.messages, (msgs) => msgs.length > secondCount);

    const firstNew = first.messages.slice(firstCount);
    const secondNew = second.messages.slice(secondCount);
    expect(firstNew.length).toBeGreaterThan(0);
    expect(secondNew.length).toBeGreaterThan(0);

    ws1.close();
    ws2.close();
    await endSession(wsId, dataDir);
  });

  it("broadcasts all session events to all hub sockets regardless of which session each initiated", async () => {
    const fakeClaudePath = join(tempDir, "fake-claude-focus.sh");
    await writeFile(fakeClaudePath, "#!/bin/sh\nsleep 6\n", "utf-8");
    await chmod(fakeClaudePath, 0o755);
    const slowCmd = { command: fakeClaudePath, systemPrompt: false as const };

    const local = await startWsApp(undefined, slowCmd);
    const first = connectHub([wsId], { app: local.app });
    const second = connectHub([wsId], { app: local.app });
    const ws1 = await first.wsReady;
    const ws2 = await second.wsReady;

    await waitForMessage(first.messages, (msgs) => msgs.some((m) => m.type === "status"));
    await waitForMessage(second.messages, (msgs) => msgs.some((m) => m.type === "status"));

    ws1.send(hubEvent(wsId, { type: "user_message", content: "session-a" }));
    await waitForMessage(
      first.messages,
      (msgs) => msgs.some(
        (m) =>
          m.type === "status" &&
          m.status === "busy" &&
          m.streaming === true &&
          typeof m.sessionId === "string",
      ),
    );

    const firstBusy = [...first.messages].reverse().find(
      (m) =>
        m.type === "status" &&
        m.status === "busy" &&
        m.streaming === true &&
        typeof m.sessionId === "string",
    );
    expect(firstBusy?.type).toBe("status");
    if (!firstBusy || firstBusy.type !== "status" || !firstBusy.sessionId) {
      throw new Error("Expected first session busy status with sessionId");
    }
    const firstSessionId = firstBusy.sessionId;

    const secondSession = await createNewSession(wsId, dataDir, slowCmd);
    ws2.send(hubEvent(wsId, { type: "switch_session", sessionId: secondSession.sessionId }));
    await waitForMessage(
      second.messages,
      (msgs) => msgs.some(
        (m) => m.type === "status" && m.sessionId === secondSession.sessionId,
      ),
    );

    const firstMarker = first.messages.length;
    const secondMarker = second.messages.length;
    ws2.send(hubEvent(wsId, {
      type: "user_message",
      content: "session-b",
      sessionId: secondSession.sessionId,
    }));

    await waitForMessage(
      second.messages,
      (msgs) =>
        msgs.slice(secondMarker).some(
          (m) =>
            m.type === "status" &&
            m.status === "busy" &&
            m.streaming === true &&
            m.sessionId === secondSession.sessionId,
        ),
    );
    await new Promise((resolve) => setTimeout(resolve, 120));

    const statusReachedFirstSocket = first.messages.slice(firstMarker).some(
      (m) =>
        m.type === "status" &&
        m.status === "busy" &&
        m.sessionId === secondSession.sessionId,
    );
    expect(statusReachedFirstSocket).toBe(true);
    expect(getSessionById(wsId, firstSessionId)?.status).toBe("streaming");
    expect(getSessionById(wsId, secondSession.sessionId)?.status).toBe("streaming");

    ws1.close();
    ws2.close();
    await local.app.close();
    await endSession(wsId, dataDir).catch(() => {});
  });

  it("keeps workspace channels isolated across workspaces on the same hub", async () => {
    const otherWorkspace = await createWorkspace(projectId, dataDir);

    // Subscribe a single hub socket to both workspaces
    const { wsReady, allEnvelopes } = connectHub([wsId], { collectAll: true });
    const ws = await wsReady;

    // Also subscribe to the other workspace
    syncWorkspaces(ws, [wsId, otherWorkspace.id]);

    await waitForCondition(() =>
      allEnvelopes.some((e) => e.workspaceId === wsId && e.event.type === "status") &&
      allEnvelopes.some((e) => e.workspaceId === otherWorkspace.id && e.event.type === "status"),
    );

    const otherEnvelopes = allEnvelopes.filter((e) => e.workspaceId === otherWorkspace.id);
    const otherStartCount = otherEnvelopes.length;

    ws.send(hubEvent(wsId, { type: "user_message", content: "workspace-one-message" }));

    await waitForCondition(() =>
      allEnvelopes.some(
        (e) => e.workspaceId === wsId && e.event.type === "user_message",
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 150));

    const leakedToOtherWorkspace = allEnvelopes
      .filter((e) => e.workspaceId === otherWorkspace.id)
      .slice(otherStartCount)
      .some(
        (e) => e.event.type === "user_message" || (e.event.type === "status" && e.event.status === "busy"),
      );
    expect(leakedToOtherWorkspace).toBe(false);

    ws.close();
    await endSession(wsId, dataDir).catch(() => {});
    await endSession(otherWorkspace.id, dataDir).catch(() => {});
  });

  it("keeps a workspace channel until the last hub socket unsubscribes, then removes it", async () => {
    const first = connectHub([wsId]);
    const second = connectHub([wsId]);
    const ws1 = await first.wsReady;
    const ws2 = await second.wsReady;

    await waitForMessage(first.messages, (msgs) => msgs.some((m) => m.type === "status"));
    await waitForMessage(second.messages, (msgs) => msgs.some((m) => m.type === "status"));
    await waitForCondition(() => _getChannelsForTests().get(wsId)?.hubSockets.size === 2);

    const ws1Closed = new Promise<void>((resolve) => {
      ws1.once("close", () => resolve());
    });
    ws1.terminate();
    await ws1Closed;
    await waitForCondition(() => _getChannelsForTests().get(wsId)?.hubSockets.size === 1);
    expect(_getChannelsForTests().has(wsId)).toBe(true);

    const ws2Closed = new Promise<void>((resolve) => {
      ws2.once("close", () => resolve());
    });
    ws2.terminate();
    await ws2Closed;
    await waitForCondition(() => !_getChannelsForTests().has(wsId));
  });

  it("reaps a hub socket that missed a WS heartbeat cycle via the existing close cleanup", async () => {
    const { wsReady, messages } = connectHub([wsId]);
    await wsReady;

    await waitForMessage(messages, (msgs) => msgs.some((m) => m.type === "status"));
    await waitForCondition(() => _getChannelsForTests().get(wsId)?.hubSockets.size === 1);

    // The injectWS client auto-answers protocol pings, so it can never die
    // naturally. Force the missed-cycle state and drive one tick by hand.
    const hub = [..._getHubSocketsForTests()].find((h) => h.subscribedWorkspaces.has(wsId));
    expect(hub).toBeDefined();
    hub!.isAlive = false;
    _tickHubLivenessForTests(hub!);

    // terminate() emits "close", which runs the existing cleanup: unsubscribe
    // from every channel, drop empty channels, and remove the hub from the set.
    await waitForCondition(() => !_getHubSocketsForTests().has(hub!));
    expect(_getChannelsForTests().has(wsId)).toBe(false);
  });

  it("keeps a hub socket alive when it responded before the heartbeat tick", async () => {
    const { wsReady, messages } = connectHub([wsId]);
    await wsReady;

    await waitForMessage(messages, (msgs) => msgs.some((m) => m.type === "status"));
    await waitForCondition(() => _getChannelsForTests().get(wsId)?.hubSockets.size === 1);

    const hub = [..._getHubSocketsForTests()].find((h) => h.subscribedWorkspaces.has(wsId));
    expect(hub).toBeDefined();
    expect(hub!.isAlive).toBe(true);

    // A live socket survives one tick but has its flag cleared, arming the
    // next cycle to reap it if no pong arrives in the meantime.
    _tickHubLivenessForTests(hub!);
    expect(_getHubSocketsForTests().has(hub!)).toBe(true);
    expect(hub!.isAlive).toBe(false);
  });

  it("does not broadcast stale idle status when a session is replaced", async () => {
    const fakeClaudePath = join(tempDir, "fake-claude.sh");
    await writeFile(fakeClaudePath, "#!/bin/sh\nsleep 5\n", "utf-8");
    await chmod(fakeClaudePath, 0o755);

    const local = await startWsApp(undefined, { command: fakeClaudePath, systemPrompt: false });
    const { wsReady, messages } = connectHub([wsId], { app: local.app });
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.length >= 1);
    const idleStatusesBefore = messages.filter(
      (m) => m.type === "status" && m.status === "idle",
    ).length;

    ws.send(hubEvent(wsId, { type: "user_message", content: "replace me" }));
    await waitForMessage(
      messages,
      (msgs) => msgs.some((m) => m.type === "status" && m.status === "busy" && m.streaming === true),
    );

    await createNewSession(wsId, dataDir, { command: fakeClaudePath, systemPrompt: false });
    await new Promise((resolve) => setTimeout(resolve, 400));

    const idleStatusesAfter = messages.filter(
      (m) => m.type === "status" && m.status === "idle",
    ).length;
    expect(idleStatusesAfter).toBe(idleStatusesBefore);

    ws.close();
    await local.app.close();
    await endSession(wsId, dataDir).catch(() => {});
  });

  it("rejects unauthorized websocket connections when auth token is configured", async () => {
    const secure = await startWsApp({ expectedToken: "secret" });
    const ws = await secure.app.injectWS(`/ws/hub`);

    const closeCode = await new Promise<number>((resolve, reject) => {
      ws.on("close", (code) => resolve(code));
      ws.on("error", reject);
    });

    expect(closeCode).toBe(1008);
    await secure.app.close();
  });

  it("accepts websocket connections with a valid auth token", async () => {
    const secure = await startWsApp({ expectedToken: "secret" });
    const { wsReady, messages } = connectHub([wsId], {
      app: secure.app,
      headers: { authorization: "Bearer secret" },
    });
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.length >= 1);
    expect(messages[0]).toEqual({ type: "status", status: "idle", streaming: false });

    ws.close();
    await secure.app.close();
  });

  it("accepts websocket connections with a valid token query parameter", async () => {
    const secure = await startWsApp({ expectedToken: "secret" });
    const { wsReady, messages } = connectHub([wsId], {
      app: secure.app,
      query: { token: "secret" },
    });
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.length >= 1);
    expect(messages[0]).toEqual({ type: "status", status: "idle", streaming: false });

    ws.close();
    await secure.app.close();
  });

  it("enforces a hash-only auth expectation on the hub socket", async () => {
    const secure = await startWsApp({
      expectedTokenSha256: createHash("sha256").update("secret").digest("hex"),
    });

    const rejected = await secure.app.injectWS(`/ws/hub`);
    const closeCode = await new Promise<number>((resolve, reject) => {
      rejected.on("close", (code) => resolve(code));
      rejected.on("error", reject);
    });
    expect(closeCode).toBe(1008);

    const { wsReady, messages } = connectHub([wsId], {
      app: secure.app,
      query: { token: "secret" },
    });
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.length >= 1);
    expect(messages[0]).toEqual({ type: "status", status: "idle", streaming: false });

    ws.close();
    await secure.app.close();
  });

  it("broadcastToWorkspace sends a message to all hub sockets subscribed to the workspace", async () => {
    const first = connectHub([wsId]);
    const second = connectHub([wsId]);
    const ws1 = await first.wsReady;
    const ws2 = await second.wsReady;

    await waitForMessage(first.messages, (msgs) => msgs.length >= 1);
    await waitForMessage(second.messages, (msgs) => msgs.length >= 1);

    const branchInfo: WsOutgoing = {
      type: "branch_info",
      info: { name: "feat/new-branch", lastSyncedAt: "2026-02-13T00:00:00.000Z" },
    };

    broadcastToWorkspace(wsId, branchInfo);

    await waitForMessage(first.messages, (msgs) =>
      msgs.some((m) => m.type === "branch_info"),
    );
    await waitForMessage(second.messages, (msgs) =>
      msgs.some((m) => m.type === "branch_info"),
    );

    const msg1 = first.messages.find((m) => m.type === "branch_info");
    const msg2 = second.messages.find((m) => m.type === "branch_info");
    expect(msg1).toEqual(branchInfo);
    expect(msg2).toEqual(branchInfo);

    ws1.close();
    ws2.close();
  });

  it("broadcastToWorkspace is a no-op for unknown workspace", () => {
    broadcastToWorkspace("ws-nonexistent", {
      type: "branch_info",
      info: { name: "test", lastSyncedAt: "2026-02-13T00:00:00.000Z" },
    });
  });

  it("sends cached branch_info and diff_stats on subscribe", async () => {
    const branchInfo = { name: "workspace/tokyo", lastSyncedAt: "2026-02-15T10:00:00.000Z" };
    const diffStats = {
      committed: [{ file: "a.ts", additions: 1, deletions: 0, status: "added" as const }],
      uncommitted: [{ file: "b.ts", additions: 0, deletions: 1, status: "modified" as const }],
    };
    const provider = {
      getCachedBranchInfo: vi.fn((workspaceId: string) =>
        workspaceId === wsId ? branchInfo : undefined,
      ),
      getCachedDiffStats: vi.fn((workspaceId: string) =>
        workspaceId === wsId ? diffStats : undefined,
      ),
    };
    const local = await startWsApp(undefined, CONV_CMD, provider);
    const { wsReady, messages } = connectHub([wsId], { app: local.app });
    const ws = await wsReady;

    await waitForMessage(
      messages,
      (msgs) => msgs.some((m) => m.type === "branch_info") && msgs.some((m) => m.type === "diff_stats"),
    );
    expect(messages[0]).toEqual({ type: "status", status: "idle", streaming: false });
    expect(messages).toContainEqual({ type: "branch_info", info: branchInfo });
    expect(messages).toContainEqual({ type: "diff_stats", stats: diffStats });
    expect(provider.getCachedBranchInfo).toHaveBeenCalledWith(wsId);
    expect(provider.getCachedDiffStats).toHaveBeenCalledWith(wsId);

    ws.close();
    await local.app.close();
  });

  it("resends bootstrap for an already subscribed workspace on forceBootstrap without reconnecting", async () => {
    const branchInfoV1: BranchInfo = { name: "workspace/tokyo", lastSyncedAt: "2026-02-15T10:00:00.000Z" };
    const diffStatsV1: DiffStatResponse = {
      committed: [{ file: "a.ts", additions: 1, deletions: 0, status: "added" }],
      uncommitted: [],
    };
    const branchInfoV2: BranchInfo = { name: "workspace/tokyo", lastSyncedAt: "2026-02-16T00:00:00.000Z" };
    const diffStatsV2: DiffStatResponse = {
      committed: [],
      uncommitted: [{ file: "b.ts", additions: 0, deletions: 2, status: "modified" }],
    };

    let branchInfo = branchInfoV1;
    let diffStats = diffStatsV1;
    const provider = {
      getCachedBranchInfo: vi.fn((workspaceId: string) =>
        workspaceId === wsId ? branchInfo : undefined,
      ),
      getCachedDiffStats: vi.fn((workspaceId: string) =>
        workspaceId === wsId ? diffStats : undefined,
      ),
    };
    const local = await startWsApp(undefined, CONV_CMD, provider);
    const { wsReady, messages } = connectHub([wsId], { app: local.app });
    const ws = await wsReady;

    await waitForMessage(
      messages,
      (msgs) => msgs.some((m) => m.type === "branch_info") && msgs.some((m) => m.type === "diff_stats"),
    );
    expect(messages).toContainEqual({ type: "branch_info", info: branchInfoV1 });
    expect(messages).toContainEqual({ type: "diff_stats", stats: diffStatsV1 });

    // Backend-side state changes while the socket stays open (e.g. a background
    // git sync completed while iOS was backgrounded).
    branchInfo = branchInfoV2;
    diffStats = diffStatsV2;

    // Re-sync the same workspace with forceBootstrap: true, simulating iOS
    // requesting a refresh over an already-healthy socket (no reconnect).
    syncWorkspaces(ws, [wsId], undefined, undefined, true);

    await waitForMessage(
      messages,
      (msgs) =>
        msgs.filter((m) => m.type === "branch_info").length >= 2 &&
        msgs.filter((m) => m.type === "diff_stats").length >= 2,
    );
    expect(messages).toContainEqual({ type: "branch_info", info: branchInfoV2 });
    expect(messages).toContainEqual({ type: "diff_stats", stats: diffStatsV2 });
    // The socket was never closed/reopened for this refresh.
    expect(ws.readyState).toBe(ws.OPEN);

    ws.close();
    await local.app.close();
  });

  it("sends PR status immediately when a workspace enters prWorkspaces", async () => {
    const prStatusProvider = {
      getCachedStatus: vi.fn(() => undefined),
      getStatus: vi.fn(async () => ({ pr: null })),
    };
    const local = await startWsApp(undefined, CONV_CMD, undefined, prStatusProvider);
    const { wsReady, messages } = connectHub([wsId], { app: local.app });
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.some((m) => m.type === "status"));
    expect(messages.some((m) => m.type === "pr_status")).toBe(false);

    syncWorkspaces(ws, [wsId], undefined, [wsId]);

    await waitForMessage(messages, (msgs) => msgs.some((m) => m.type === "pr_status"));
    expect(prStatusProvider.getStatus).toHaveBeenCalledWith(wsId);
    expect(messages).toContainEqual({ type: "pr_status", status: { pr: null } });

    ws.close();
    await local.app.close();
  });

  it("sends PR status when a PR-flagged workspace later becomes subscribed", async () => {
    const prStatusProvider = {
      getCachedStatus: vi.fn(() => undefined),
      getStatus: vi.fn(async () => ({ pr: null })),
    };
    const local = await startWsApp(undefined, CONV_CMD, undefined, prStatusProvider);
    // Sidebar effects can flag PR interest before the app-level sync sends the
    // full subscription list: the first sync carries prWorkspaces while the
    // workspace is still missing from workspaceIds, so nothing is sent yet.
    const { wsReady, messages, allEnvelopes } = connectHub([], {
      app: local.app,
      collectAll: true,
      prWorkspaces: [wsId],
    });
    const ws = await wsReady;

    await new Promise((r) => setTimeout(r, 100));
    expect(allEnvelopes.some((e) => e.event.type === "pr_status")).toBe(false);

    // The follow-up sync subscribes the workspace; prWorkspaces is unchanged.
    // The initial status must be delivered now, not skipped as already-flagged.
    syncWorkspaces(ws, [wsId], undefined, [wsId]);

    await waitForMessage(messages, (msgs) => msgs.some((m) => m.type === "pr_status"));
    expect(prStatusProvider.getStatus).toHaveBeenCalledWith(wsId);
    expect(messages).toContainEqual({ type: "pr_status", status: { pr: null } });

    ws.close();
    await local.app.close();
  });

  it("broadcasts PR status only to hubs interested in that workspace", async () => {
    const interested = connectHub([wsId], { collectAll: true, prWorkspaces: [wsId] });
    const uninterested = connectHub([wsId], { collectAll: true });
    const wsInterested = await interested.wsReady;
    const wsUninterested = await uninterested.wsReady;

    await waitForCondition(() =>
      interested.allEnvelopes.some((e) => e.event.type === "status") &&
      uninterested.allEnvelopes.some((e) => e.event.type === "status"),
    );

    broadcastToWorkspace(wsId, { type: "pr_status", status: { pr: null } });

    await waitForCondition(() =>
      interested.allEnvelopes.some((e) => e.event.type === "pr_status"),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(interested.allEnvelopes.some((e) => e.event.type === "pr_status")).toBe(true);
    expect(uninterested.allEnvelopes.some((e) => e.event.type === "pr_status")).toBe(false);

    wsInterested.close();
    wsUninterested.close();
  });

  it("delivers snapshots and script_status to listeners attached after injectWS resolves", async () => {
    const branchInfo = { name: "workspace/late-listener", lastSyncedAt: "2026-02-18T10:00:00.000Z" };
    const diffStats = {
      committed: [{ file: "c.ts", additions: 2, deletions: 0, status: "added" as const }],
      uncommitted: [{ file: "d.ts", additions: 0, deletions: 3, status: "modified" as const }],
    };
    _setScriptStatusForTests(wsId, "backend", "running");

    const provider = {
      getCachedBranchInfo: vi.fn((workspaceId: string) =>
        workspaceId === wsId ? branchInfo : undefined,
      ),
      getCachedDiffStats: vi.fn((workspaceId: string) =>
        workspaceId === wsId ? diffStats : undefined,
      ),
    };
    const local = await startWsApp(undefined, CONV_CMD, provider);

    const { ws, messages } = await connectHubLateListener([wsId], { app: local.app });

    await waitForMessage(
      messages,
      (msgs) =>
        msgs.some((m) => m.type === "status") &&
        msgs.some((m) => m.type === "branch_info") &&
        msgs.some((m) => m.type === "diff_stats") &&
        msgs.some((m) => m.type === "script_status"),
    );

    expect(messages).toContainEqual({ type: "branch_info", info: branchInfo });
    expect(messages).toContainEqual({ type: "diff_stats", stats: diffStats });
    expect(messages).toContainEqual({
      type: "script_status",
      scriptType: "backend",
      state: "running",
    });
    expect(provider.getCachedBranchInfo).toHaveBeenCalledWith(wsId);
    expect(provider.getCachedDiffStats).toHaveBeenCalledWith(wsId);

    ws.close();
    await local.app.close();
  });

  it("does not send snapshots when provider returns undefined for workspace", async () => {
    const provider = {
      getCachedBranchInfo: vi.fn(() => undefined),
      getCachedDiffStats: vi.fn(() => undefined),
    };
    const local = await startWsApp(undefined, CONV_CMD, provider);
    const { wsReady, messages } = connectHub([wsId], { app: local.app });
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.some((m) => m.type === "status"));
    await new Promise((r) => setTimeout(r, 100));

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: "status", status: "idle", streaming: false });
    expect(messages.some((m) => m.type === "branch_info")).toBe(false);
    expect(messages.some((m) => m.type === "diff_stats")).toBe(false);

    ws.close();
    await local.app.close();
  });

  it("sends script_status on subscribe when a script is running", async () => {
    _setScriptStatusForTests(wsId, "run", "running");

    const { wsReady, messages } = connectHub([wsId]);
    const ws = await wsReady;

    await waitForMessage(
      messages,
      (msgs) => msgs.some((m) => m.type === "script_status"),
    );

    const scriptMsg = messages.find((m) => m.type === "script_status");
    expect(scriptMsg).toEqual({
      type: "script_status",
      scriptType: "run",
      state: "running",
    });

    ws.close();
  });

  it("sends script_status for each non-idle named script on subscribe", async () => {
    _setScriptStatusForTests(wsId, "backend", "running");
    _setScriptStatusForTests(wsId, "frontend", "done", 0);

    const { wsReady, messages } = connectHub([wsId]);
    const ws = await wsReady;

    await waitForMessage(
      messages,
      (msgs) => msgs.filter((m) => m.type === "script_status").length >= 2,
    );

    expect(messages).toContainEqual({
      type: "script_status",
      scriptType: "backend",
      state: "running",
    });
    expect(messages).toContainEqual({
      type: "script_status",
      scriptType: "frontend",
      state: "done",
      exitCode: 0,
    });

    ws.close();
  });

  it("sends script_status with exitCode on subscribe when a script has finished", async () => {
    _setScriptStatusForTests(wsId, "setup", "error", 1);

    const { wsReady, messages } = connectHub([wsId]);
    const ws = await wsReady;

    await waitForMessage(
      messages,
      (msgs) => msgs.some((m) => m.type === "script_status"),
    );

    const scriptMsg = messages.find((m) => m.type === "script_status");
    expect(scriptMsg).toEqual({
      type: "script_status",
      scriptType: "setup",
      state: "error",
      exitCode: 1,
    });

    ws.close();
  });

  it("does not send script_status on subscribe when all scripts are idle", async () => {
    const { wsReady, messages } = connectHub([wsId]);
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.some((m) => m.type === "status"));
    await new Promise((r) => setTimeout(r, 100));

    expect(messages.some((m) => m.type === "script_status")).toBe(false);

    ws.close();
  });

  it("sends snapshots after busy status when session exists", async () => {
    const branchInfo = { name: "workspace/tokyo", lastSyncedAt: "2026-02-15T10:00:00.000Z" };
    const diffStats = { committed: [], uncommitted: [] };
    const provider = {
      getCachedBranchInfo: vi.fn((id: string) => (id === wsId ? branchInfo : undefined)),
      getCachedDiffStats: vi.fn((id: string) => (id === wsId ? diffStats : undefined)),
    };
    const local = await startWsApp(undefined, CONV_CMD, provider);

    await getOrCreateSession(wsId, dataDir, CONV_CMD);

    const { wsReady, messages } = connectHub([wsId], { app: local.app });
    const ws = await wsReady;

    await waitForMessage(
      messages,
      (msgs) =>
        msgs.some((m) => m.type === "status" && (m.status === "busy" || m.status === "idle")) &&
        msgs.some((m) => m.type === "branch_info") &&
        msgs.some((m) => m.type === "diff_stats"),
    );

    expect(messages[0]).toEqual(
      expect.objectContaining({ type: "status", status: "idle" }),
    );
    expect(messages).toContainEqual({ type: "branch_info", info: branchInfo });
    expect(messages).toContainEqual({ type: "diff_stats", stats: diffStats });

    ws.close();
    await local.app.close();
    await endSession(wsId, dataDir).catch(() => {});
  });

  it("sync_workspaces adds and removes workspace subscriptions dynamically", async () => {
    const otherWorkspace = await createWorkspace(projectId, dataDir);

    const { wsReady, allEnvelopes } = connectHub([wsId], { collectAll: true });
    const ws = await wsReady;

    // Wait for initial bootstrap
    await waitForCondition(() =>
      allEnvelopes.some((e) => e.workspaceId === wsId && e.event.type === "status"),
    );

    // Add second workspace
    syncWorkspaces(ws, [wsId, otherWorkspace.id]);
    await waitForCondition(() =>
      allEnvelopes.some((e) => e.workspaceId === otherWorkspace.id && e.event.type === "status"),
    );

    // Remove first workspace
    syncWorkspaces(ws, [otherWorkspace.id]);
    await new Promise((r) => setTimeout(r, 100));

    // Channel for wsId should be cleaned up (no hub sockets left)
    const wsChannel = _getChannelsForTests().get(wsId);
    expect(!wsChannel || wsChannel.hubSockets.size === 0).toBe(true);

    // Channel for other workspace should still exist
    const otherChannel = _getChannelsForTests().get(otherWorkspace.id);
    expect(otherChannel?.hubSockets.size).toBe(1);

    ws.close();
  });

  it("processes overlapping sync_workspaces messages in send order", async () => {
    const otherWorkspace = await createWorkspace(projectId, dataDir);

    const { wsReady } = connectHub([wsId]);
    const ws = await wsReady;

    // The first sync awaits the new workspace bootstrap. The second sync must
    // wait for it instead of undoing its state changes mid-bootstrap.
    syncWorkspaces(ws, [wsId, otherWorkspace.id]);
    syncWorkspaces(ws, [wsId]);

    await waitForCondition(() => {
      const channel = _getChannelsForTests().get(otherWorkspace.id);
      return !channel || channel.hubSockets.size === 0;
    });

    expect(_getChannelsForTests().get(wsId)?.hubSockets.size).toBe(1);
    expect(_getChannelsForTests().get(otherWorkspace.id)?.hubSockets.size ?? 0).toBe(0);

    ws.close();
  });

  it("authorizes a user_message racing a sync queued behind a slow PR refresh", async () => {
    let resolvePr!: (value: { pr: null }) => void;
    const deferred = new Promise<{ pr: null }>((resolve) => { resolvePr = resolve; });
    const prStatusProvider = {
      getCachedStatus: vi.fn(() => undefined),
      getStatus: vi.fn(() => deferred),
    };
    const local = await startWsApp(undefined, CONV_CMD, undefined, prStatusProvider);
    const otherWorkspace = await createWorkspace(projectId, dataDir);

    const { wsReady, allEnvelopes } = connectHub([wsId], {
      app: local.app,
      collectAll: true,
      prWorkspaces: [wsId],
    });
    const ws = await wsReady;
    await waitForCondition(() => allEnvelopes.some((e) => e.event.type === "status"));

    // The PR refresh above is still pending. A follow-up sync adding a
    // workspace plus an immediate message to it must be authorized:
    // subscription intent is recorded at receipt, not when the queued sync
    // finally runs.
    syncWorkspaces(ws, [wsId, otherWorkspace.id], undefined, [wsId]);
    ws.send(hubEvent(otherWorkspace.id, { type: "user_message", content: "race" }));

    await waitForCondition(() =>
      allEnvelopes.some((e) =>
        e.workspaceId === otherWorkspace.id &&
        e.event.type === "status" &&
        e.event.streaming === true,
      ),
    );
    expect(
      allEnvelopes.some(
        (e) => e.event.type === "error" && e.event.message.includes("Not subscribed"),
      ),
    ).toBe(false);

    resolvePr({ pr: null });
    ws.close();
    await endSession(otherWorkspace.id, dataDir).catch(() => {});
    await local.app.close();
  });

  it("drops a queued sync when the socket closes before it runs", async () => {
    let resolvePr!: (value: { pr: null }) => void;
    const deferred = new Promise<{ pr: null }>((resolve) => { resolvePr = resolve; });
    const prStatusProvider = {
      getCachedStatus: vi.fn(() => undefined),
      getStatus: vi.fn(() => deferred),
    };
    const local = await startWsApp(undefined, CONV_CMD, undefined, prStatusProvider);
    const otherWorkspace = await createWorkspace(projectId, dataDir);

    const { wsReady, allEnvelopes } = connectHub([wsId], {
      app: local.app,
      collectAll: true,
      prWorkspaces: [wsId],
    });
    const ws = await wsReady;
    await waitForCondition(() => allEnvelopes.some((e) => e.event.type === "status"));

    // Queue a sync behind the pending PR refresh, then drop the socket
    // server-side (client-initiated close does not propagate under injectWS).
    // The queued sync must not run after close and re-create channels for a
    // dead socket.
    syncWorkspaces(ws, [wsId, otherWorkspace.id], undefined, [wsId]);
    // Let the frame reach the server so the sync is actually queued.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const hub = [..._getHubSocketsForTests()].find((h) => h.subscribedWorkspaces.has(wsId));
    hub!.ws.terminate();
    await waitForCondition(() => !_getHubSocketsForTests().has(hub!));

    resolvePr({ pr: null });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(_getChannelsForTests().get(otherWorkspace.id)).toBeUndefined();
    expect(_getChannelsForTests().get(wsId)).toBeUndefined();
    await local.app.close();
  });

  it("delivers high-frequency events only to focused workspaces (C13)", async () => {
    const unfocused = (await createWorkspace(projectId, dataDir)).id;

    const { wsReady, allEnvelopes } = connectHub([wsId, unfocused], {
      collectAll: true,
      focusWorkspaces: [wsId],
    });
    const ws = await wsReady;

    await waitForCondition(() =>
      allEnvelopes.some((e) => e.workspaceId === wsId && e.event.type === "status") &&
      allEnvelopes.some((e) => e.workspaceId === unfocused && e.event.type === "status"),
    );

    broadcastToWorkspace(unfocused, { type: "text_delta", sessionId: "s", text: "hidden" });
    broadcastToWorkspace(wsId, { type: "text_delta", sessionId: "s", text: "shown" });
    broadcastToWorkspace(unfocused, {
      type: "branch_info",
      info: { name: "feature-x", lastSyncedAt: "2026-02-10T00:00:00.000Z" },
    });

    await waitForCondition(() =>
      allEnvelopes.some((e) => e.event.type === "text_delta" && e.workspaceId === wsId) &&
      allEnvelopes.some((e) => e.event.type === "branch_info" && e.workspaceId === unfocused),
    );

    const deltas = allEnvelopes.filter((e) => e.event.type === "text_delta");
    expect(deltas.length).toBe(1);
    expect(deltas[0]?.workspaceId).toBe(wsId);

    ws.close();
  });

  it("replays the streaming snapshot when an already-subscribed workspace enters focus (C13)", async () => {
    const fakeClaudePath = join(tempDir, "fake-claude-focus-replay.sh");
    await writeFile(fakeClaudePath, "#!/bin/sh\nsleep 5\n", "utf-8");
    await chmod(fakeClaudePath, 0o755);
    const slowCmd = { command: fakeClaudePath, systemPrompt: false as const };
    const local = await startWsApp(undefined, slowCmd);

    const other = await createWorkspace(projectId, dataDir);
    const { session } = await getOrCreateSession(other.id, dataDir, slowCmd);
    session.sendMessage("streaming on other");
    if (!session.getStreamingSnapshot()) throw new Error("Expected a streaming snapshot");

    const { wsReady, allEnvelopes } = connectHub([wsId, other.id], {
      app: local.app,
      collectAll: true,
      focusWorkspaces: [wsId],
    });
    const ws = await wsReady;

    const snapshotsForOther = () =>
      allEnvelopes.filter((e) => e.workspaceId === other.id && e.event.type === "stream_snapshot");

    // The unfocused workspace still receives its low-frequency `status`
    // bootstrap, which proves it is subscribed.
    await waitForCondition(() =>
      allEnvelopes.some((e) => e.workspaceId === other.id && e.event.type === "status"),
    );

    // But its high-frequency `stream_snapshot` bootstrap is filtered out while
    // it is not focused.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(snapshotsForOther().length).toBe(0);

    // Entering focus replays the streaming snapshot exactly once.
    syncWorkspaces(ws, [wsId, other.id], [other.id]);
    await waitForCondition(() => snapshotsForOther().length === 1);

    ws.close();
    await local.app.close();
    await endSession(other.id, dataDir).catch(() => {});
  });

  it("does not replay the streaming snapshot when focusWorkspaces is unchanged", async () => {
    const fakeClaudePath = join(tempDir, "fake-claude-same-focus.sh");
    await writeFile(fakeClaudePath, "#!/bin/sh\nsleep 5\n", "utf-8");
    await chmod(fakeClaudePath, 0o755);
    const slowCmd = { command: fakeClaudePath, systemPrompt: false as const };
    const local = await startWsApp(undefined, slowCmd);

    const { session } = await getOrCreateSession(wsId, dataDir, slowCmd);
    session.sendMessage("streaming on focused workspace");
    if (!session.getStreamingSnapshot()) throw new Error("Expected a streaming snapshot");

    const { wsReady, allEnvelopes } = connectHub([wsId], {
      app: local.app,
      collectAll: true,
      focusWorkspaces: [wsId],
    });
    const ws = await wsReady;

    const snapshotsForWs = () =>
      allEnvelopes.filter((e) => e.workspaceId === wsId && e.event.type === "stream_snapshot");

    await waitForCondition(() => snapshotsForWs().length === 1);

    syncWorkspaces(ws, [wsId], [wsId]);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(snapshotsForWs().length).toBe(1);

    ws.close();
    await local.app.close();
    await endSession(wsId, dataDir).catch(() => {});
  });

  it("resends the streaming snapshot exactly once for a focused workspace on forceBootstrap", async () => {
    const fakeClaudePath = join(tempDir, "fake-claude-force-bootstrap-focus.sh");
    await writeFile(fakeClaudePath, "#!/bin/sh\nsleep 5\n", "utf-8");
    await chmod(fakeClaudePath, 0o755);
    const slowCmd = { command: fakeClaudePath, systemPrompt: false as const };
    const local = await startWsApp(undefined, slowCmd);

    const { session } = await getOrCreateSession(wsId, dataDir, slowCmd);
    session.sendMessage("streaming on focused workspace");
    if (!session.getStreamingSnapshot()) throw new Error("Expected a streaming snapshot");

    const { wsReady, allEnvelopes } = connectHub([wsId], {
      app: local.app,
      collectAll: true,
      focusWorkspaces: [wsId],
    });
    const ws = await wsReady;

    const snapshotsForWs = () =>
      allEnvelopes.filter((e) => e.workspaceId === wsId && e.event.type === "stream_snapshot");

    // Initial bootstrap ships exactly one snapshot for the focused, streaming workspace.
    await waitForCondition(() => snapshotsForWs().length === 1);

    // A forced refresh re-syncing the same already-focused workspace resends
    // the full bootstrap (one fresh snapshot) via a single code path -- it must
    // NOT also fire the separate focus-enter replay, which would produce two
    // additional snapshots (three total) instead of one (two total).
    syncWorkspaces(ws, [wsId], [wsId], undefined, true);
    await waitForCondition(() => snapshotsForWs().length === 2);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(snapshotsForWs().length).toBe(2);

    ws.close();
    await local.app.close();
    await endSession(wsId, dataDir).catch(() => {});
  });

  it("replays the streaming snapshot only for the targeted workspace via request_stream_snapshots", async () => {
    const fakeClaudePath = join(tempDir, "fake-claude-request-stream-snapshots.sh");
    await writeFile(fakeClaudePath, "#!/bin/sh\nsleep 5\n", "utf-8");
    await chmod(fakeClaudePath, 0o755);
    const slowCmd = { command: fakeClaudePath, systemPrompt: false as const };
    const local = await startWsApp(undefined, slowCmd);

    const other = await createWorkspace(projectId, dataDir);

    const { session: targetSession } = await getOrCreateSession(wsId, dataDir, slowCmd);
    targetSession.sendMessage("streaming on target");
    const targetSnapshotData = targetSession.getStreamingSnapshot();
    if (!targetSnapshotData) throw new Error("Expected a streaming snapshot on target");
    vi.spyOn(targetSession, "getStreamingSnapshot").mockReturnValue({
      ...targetSnapshotData,
      text: "target snapshot text",
    });

    const { session: otherSession } = await getOrCreateSession(other.id, dataDir, slowCmd);
    otherSession.sendMessage("streaming on other");
    if (!otherSession.getStreamingSnapshot()) throw new Error("Expected a streaming snapshot on other");

    const { wsReady, allEnvelopes } = connectHub([wsId, other.id], {
      app: local.app,
      collectAll: true,
    });
    const ws = await wsReady;

    const snapshotsFor = (id: string) =>
      allEnvelopes.filter((e) => e.workspaceId === id && e.event.type === "stream_snapshot");

    // Initial bootstrap ships exactly one snapshot per streaming workspace.
    await waitForCondition(
      () => snapshotsFor(wsId).length === 1 && snapshotsFor(other.id).length === 1,
    );

    const otherEnvelopeCountBefore = allEnvelopes.filter((e) => e.workspaceId === other.id).length;

    ws.send(hubEvent(wsId, { type: "request_stream_snapshots" }));

    await waitForCondition(() => snapshotsFor(wsId).length === 2);
    const replayed = snapshotsFor(wsId)[1]?.event as Extract<WsOutgoing, { type: "stream_snapshot" }>;
    expect(replayed.sessionId).toBe(targetSession.sessionId);
    expect(replayed.text).toBe("target snapshot text");

    // The untargeted workspace must not receive any additional event (snapshot,
    // status, branch, diff, script, browser, or PR) purely because a sibling
    // workspace was targeted -- unlike forceBootstrap, this request is scoped
    // to exactly the addressed workspace.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(allEnvelopes.filter((e) => e.workspaceId === other.id).length).toBe(otherEnvelopeCountBefore);
    expect(snapshotsFor(wsId).length).toBe(2);
    expect(ws.readyState).toBe(ws.OPEN);

    ws.close();
    await local.app.close();
    await endSession(wsId, dataDir).catch(() => {});
    await endSession(other.id, dataDir).catch(() => {});
  });

  it("request_stream_snapshots on an idle workspace emits nothing and does not create or activate a session", async () => {
    const { wsReady, allEnvelopes } = connectHub([wsId], { collectAll: true });
    const ws = await wsReady;

    await waitForCondition(() => allEnvelopes.some((e) => e.event.type === "status"));
    expect(getSession(wsId)).toBeUndefined();

    const countBefore = allEnvelopes.length;
    ws.send(hubEvent(wsId, { type: "request_stream_snapshots" }));

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(allEnvelopes.length).toBe(countBefore);
    expect(getSession(wsId)).toBeUndefined();
    expect(ws.readyState).toBe(ws.OPEN);

    ws.close();
  });
});

describe("completionProviderForMessage", () => {
  it("maps claude model ids to the claude scan", () => {
    expect(completionProviderForMessage("claude:opus-4-8", undefined)).toBe("claude");
  });

  it("maps codex model ids to the codex scan", () => {
    expect(completionProviderForMessage("codex:gpt-5.5", undefined)).toBe("codex");
  });

  it("maps kimi model ids to the claude scan (kimi rides the claude CLI)", () => {
    expect(completionProviderForMessage("kimi:k3", undefined)).toBe("claude");
  });

  it("prefers the session's locked provider over the message model", () => {
    expect(completionProviderForMessage("claude:opus-4-8", "codex")).toBe("codex");
    expect(completionProviderForMessage("codex:gpt-5.5", "kimi")).toBe("claude");
  });

  it("returns null for unknown or missing providers", () => {
    expect(completionProviderForMessage(undefined, undefined)).toBeNull();
    expect(completionProviderForMessage("mystery:model", undefined)).toBeNull();
  });
});
