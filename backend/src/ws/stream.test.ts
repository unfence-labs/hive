import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import WebSocket from "ws";
import { chmod, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir, createFixtureRepo } from "../utils/test-helpers.js";
import { createProject } from "../projects/project-manager.js";
import { createWorkspace } from "../workspaces/workspace-manager.js";
import {
  getOrCreateSession,
  getSessionById,
  createNewSession,
  sendMessage,
  hardDeleteSession,
  endSession,
  _clearActiveSessions,
} from "../agents/agent-manager.js";
import type { SessionOptions } from "../agents/agent-manager.js";
import { streamRoutes, broadcastToWorkspace, _getChannelsForTests, _getHubSocketsForTests } from "./stream.js";
import {
  _setScriptStatusForTests,
  _clearAll as clearScripts,
} from "../services/script-runner.js";
import type { WsOutgoing, HubOutgoing } from "../types.js";

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
function syncWorkspaces(ws: WebSocket, workspaceIds: string[]): void {
  ws.send(JSON.stringify({ type: "sync_workspaces", workspaceIds }));
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
  },
): {
  wsReady: Promise<WebSocket>;
  messages: WsOutgoing[];
  allEnvelopes: HubOutgoing[];
} {
  const queryString = opts?.query
    ? `?${new URLSearchParams(opts.query).toString()}`
    : "";
  const path = `/ws/hub${queryString}`;
  const messages: WsOutgoing[] = [];
  const allEnvelopes: HubOutgoing[] = [];
  const targetWsId = workspaceIds[0];
  const wsReady = (opts?.app ?? app).injectWS(
    path,
    { headers: opts?.headers },
    {
      onInit: (ws) => {
        ws.on("message", (data: Buffer) => {
          const envelope = JSON.parse(data.toString()) as HubOutgoing;
          allEnvelopes.push(envelope);
          if (opts?.collectAll || envelope.workspaceId === targetWsId) {
            messages.push(envelope.event);
          }
        });
        // Subscribe to workspaces after the connection is established
        ws.on("open", () => {
          syncWorkspaces(ws, workspaceIds);
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
  const allEnvelopes: HubOutgoing[] = [];
  const targetWsId = workspaceIds[0];

  // Simulate clients that install message handlers right after websocket init.
  await Promise.resolve();
  ws.on("message", (data: Buffer) => {
    const envelope = JSON.parse(data.toString()) as HubOutgoing;
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
  authToken?: string,
  sessionOptions: SessionOptions = CONV_CMD,
  gitSyncSnapshotProvider?: {
    getCachedBranchInfo: (
      workspaceId: string,
    ) => Extract<WsOutgoing, { type: "branch_info" }>["info"] | undefined;
    getCachedDiffStats: (
      workspaceId: string,
    ) => Extract<WsOutgoing, { type: "diff_stats" }>["stats"] | undefined;
  },
): Promise<{ app: FastifyInstance }> {
  const localApp = Fastify();
  await localApp.register(websocket, { options: { maxPayload: 10 * 1024 * 1024 } });
  await localApp.register((instance: FastifyInstance) =>
    streamRoutes(instance, {
      dataDir,
      sessionOptions,
      authToken,
      gitSyncSnapshotProvider,
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

  it("sends persisted history even when no active session exists", async () => {
    const sessionId = "sess-persisted";
    const sessionDir = join(dataDir, projectId, "sessions", sessionId);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "metadata.json"),
      JSON.stringify({
        sessionId,
        workspaceId: wsId,
        createdAt: "2026-02-11T00:00:00.000Z",
        updatedAt: "2026-02-11T00:00:01.000Z",
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
        content: "persisted response",
        timestamp: "2026-02-11T00:00:00.000Z",
      }) + "\n",
      "utf-8",
    );

    const { wsReady, messages } = connectHub([wsId]);
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.some((m) => m.type === "history"));

    const history = messages.find((m) => m.type === "history");
    expect(history).toBeDefined();
    if (history?.type === "history") {
      expect(history.messages).toEqual([
        expect.objectContaining({
          content: "persisted response",
          role: "assistant",
        }),
      ]);
    }

    ws.close();
  });

  it("delivers persisted history when listener is attached after injectWS resolves", async () => {
    const sessionId = "sess-persisted-late";
    const sessionDir = join(dataDir, projectId, "sessions", sessionId);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "metadata.json"),
      JSON.stringify({
        sessionId,
        workspaceId: wsId,
        createdAt: "2026-02-11T00:00:00.000Z",
        updatedAt: "2026-02-11T00:00:01.000Z",
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
        content: "persisted response late listener",
        timestamp: "2026-02-11T00:00:00.000Z",
      }) + "\n",
      "utf-8",
    );

    const { ws, messages } = await connectHubLateListener([wsId]);

    await waitForMessage(messages, (msgs) => msgs.some((m) => m.type === "history"));

    const history = messages.find((m) => m.type === "history");
    expect(history).toBeDefined();
    if (history?.type === "history") {
      expect(history.messages).toEqual([
        expect.objectContaining({
          content: "persisted response late listener",
          role: "assistant",
        }),
      ]);
    }

    ws.close();
  });

  it("sends idle status + history when session exists but is not streaming", async () => {
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

  it("replays streaming agent activities during bootstrap", async () => {
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
      (msgs) => msgs.some((m) => m.type === "agent_activity" && m.activity.id === "cmd-bootstrap"),
    );

    expect(messages).toContainEqual({
      type: "agent_activity",
      sessionId: session.sessionId,
      activity: {
        id: "cmd-bootstrap",
        kind: "command_execution",
        command: "npm test",
        status: "inProgress",
        output: "running\n",
      },
    });

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

    await new Promise((resolve) => setTimeout(resolve, 100));

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

    ws1.send(hubEvent(wsId, { type: "user_message", content: "cross-client-sync" }));

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
    }
    if (secondUserEvent?.type === "user_message") {
      expect(secondUserEvent.message.role).toBe("user");
      expect(secondUserEvent.message.content).toBe("cross-client-sync");
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
    const secure = await startWsApp("secret");
    const ws = await secure.app.injectWS(`/ws/hub`);

    const closeCode = await new Promise<number>((resolve, reject) => {
      ws.on("close", (code) => resolve(code));
      ws.on("error", reject);
    });

    expect(closeCode).toBe(1008);
    await secure.app.close();
  });

  it("accepts websocket connections with a valid auth token", async () => {
    const secure = await startWsApp("secret");
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
    const secure = await startWsApp("secret");
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
});
