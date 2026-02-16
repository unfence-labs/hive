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
  endSession,
  _clearActiveSessions,
} from "../agents/agent-manager.js";
import type { SessionOptions } from "../agents/agent-manager.js";
import { streamRoutes, broadcastToWorkspace, _getChannelsForTests } from "./stream.js";
import type { WsOutgoing } from "../types.js";

const CONV_CMD = { command: "bash" };

let tempDir: string;
let dataDir: string;
let app: FastifyInstance;
let address: string;
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
  address = await app.listen({ port: 0, host: "127.0.0.1" });
});

afterEach(async () => {
  _clearActiveSessions();
  await new Promise((r) => setTimeout(r, 100));
  await app.close();
  await rm(tempDir, { recursive: true, force: true });
});

/** Connect a WebSocket and start collecting messages immediately. */
function connectSessionWs(
  workspaceId: string,
  opts?: { address?: string; headers?: Record<string, string> },
): {
  wsReady: Promise<WebSocket>;
  messages: WsOutgoing[];
} {
  const wsUrl = (opts?.address ?? address).replace("http://", "ws://");
  const messages: WsOutgoing[] = [];
  const ws = new WebSocket(`${wsUrl}/ws/session/${workspaceId}`, {
    headers: opts?.headers,
  });
  ws.on("message", (data) => {
    messages.push(JSON.parse(data.toString()) as WsOutgoing);
  });
  const wsReady = new Promise<WebSocket>((resolve, reject) => {
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
  return { wsReady, messages };
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
): Promise<{ app: FastifyInstance; address: string }> {
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
  const localAddress = await localApp.listen({ port: 0, host: "127.0.0.1" });
  return { app: localApp, address: localAddress };
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

describe("WS /ws/session/:wsId", () => {
  it("sends idle status when no session exists", async () => {
    const { wsReady, messages } = connectSessionWs(wsId);
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.length >= 1);

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

    const { wsReady, messages } = connectSessionWs(wsId);
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

  it("sends idle status + history when session exists but is not streaming", async () => {
    await getOrCreateSession(wsId, dataDir, CONV_CMD);

    const { wsReady, messages } = connectSessionWs(wsId);
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

  it("auto-creates session on user_message", async () => {
    const { wsReady, messages } = connectSessionWs(wsId);
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.length >= 1); // initial status

    // Send user message — auto-creates session
    ws.send(JSON.stringify({ type: "user_message", content: "Hello" }));

    // Should get a status update with sessionId
    await waitForMessage(
      messages,
      (msgs) => msgs.some((m) => m.type === "status" && "sessionId" in m && m.sessionId),
    ).catch(() => {});

    // Session should exist now
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

  it("accepts user_message options and keeps stream status busy", async () => {
    const { wsReady, messages } = connectSessionWs(wsId);
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.length >= 1);

    ws.send(JSON.stringify({
      type: "user_message",
      content: "Hello with options",
      options: { planMode: true, thinkingEnabled: false },
    }));

    await waitForMessage(
      messages,
      (msgs) => msgs.some((m) => m.type === "status" && m.status === "busy" && m.streaming === true),
    );

    ws.close();
    await endSession(wsId, dataDir).catch(() => {});
  });

  it("switches sessions without interrupting an already streaming session", async () => {
    const fakeClaudePath = join(tempDir, "fake-claude-sleep.sh");
    await writeFile(fakeClaudePath, "#!/bin/sh\nsleep 5\n", "utf-8");
    await chmod(fakeClaudePath, 0o755);
    const slowCmd = { command: fakeClaudePath, systemPrompt: false as const };

    const local = await startWsApp(undefined, slowCmd);
    const { wsReady, messages } = connectSessionWs(wsId, { address: local.address });
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.length >= 1);

    ws.send(JSON.stringify({ type: "user_message", content: "first in session A" }));
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
    ws.send(JSON.stringify({ type: "switch_session", sessionId: secondSession.sessionId }));
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

    ws.send(JSON.stringify({
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
    const { wsReady, messages } = connectSessionWs(wsId);
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.length >= 1);

    ws.send(JSON.stringify({
      type: "tool_input_response",
      requestId: "req-1",
      toolName: "ExitPlanMode",
      result: { type: "approve" },
    }));

    await waitForMessage(
      messages,
      (msgs) => msgs.some((m) => m.type === "status" && m.status === "busy" && m.streaming === true),
    );

    ws.close();
    await endSession(wsId, dataDir).catch(() => {});
  });

  it("routes dismiss responses to the originating session after handoff", async () => {
    const { session: oldSession } = await getOrCreateSession(wsId, dataDir, CONV_CMD);
    const oldRespondSpy = vi.spyOn(oldSession, "respondToToolInput");

    const { wsReady, messages } = connectSessionWs(wsId);
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

    ws.send(JSON.stringify({
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

  it("broadcasts user_message event to all connected clients", async () => {
    const first = connectSessionWs(wsId);
    const second = connectSessionWs(wsId);
    const ws1 = await first.wsReady;
    const ws2 = await second.wsReady;

    await waitForMessage(first.messages, (msgs) => msgs.length >= 1);
    await waitForMessage(second.messages, (msgs) => msgs.length >= 1);

    ws1.send(JSON.stringify({ type: "user_message", content: "cross-client-sync" }));

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
    const { wsReady, messages } = connectSessionWs(wsId);
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.length >= 1);

    ws.send("not json at all");

    await waitForMessage(messages, (msgs) => msgs.some((m) => m.type === "error"));

    const errorMsg = messages.find((m) => m.type === "error");
    expect(errorMsg).toBeDefined();
    if (errorMsg?.type === "error") {
      expect(errorMsg.message).toContain("Invalid JSON");
    }

    ws.close();
    await endSession(wsId, dataDir);
  });

  it("handles stop command without error", async () => {
    await getOrCreateSession(wsId, dataDir, CONV_CMD);
    const { wsReady, messages } = connectSessionWs(wsId);
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.length >= 1);

    // Stop when not streaming — no-op, no error
    ws.send(JSON.stringify({ type: "stop" }));

    await new Promise((r) => setTimeout(r, 100));

    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
    await endSession(wsId, dataDir);
  });

  it("broadcasts session events to multiple connected clients", async () => {
    await getOrCreateSession(wsId, dataDir, CONV_CMD);

    const first = connectSessionWs(wsId);
    const second = connectSessionWs(wsId);
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

  it("routes session-scoped status updates only to sockets focused on that session", async () => {
    const fakeClaudePath = join(tempDir, "fake-claude-focus.sh");
    await writeFile(fakeClaudePath, "#!/bin/sh\nsleep 6\n", "utf-8");
    await chmod(fakeClaudePath, 0o755);
    const slowCmd = { command: fakeClaudePath, systemPrompt: false as const };

    const local = await startWsApp(undefined, slowCmd);
    const first = connectSessionWs(wsId, { address: local.address });
    const second = connectSessionWs(wsId, { address: local.address });
    const ws1 = await first.wsReady;
    const ws2 = await second.wsReady;

    await waitForMessage(first.messages, (msgs) => msgs.some((m) => m.type === "status"));
    await waitForMessage(second.messages, (msgs) => msgs.some((m) => m.type === "status"));

    ws1.send(JSON.stringify({ type: "user_message", content: "session-a" }));
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
    ws2.send(JSON.stringify({ type: "switch_session", sessionId: secondSession.sessionId }));
    await waitForMessage(
      second.messages,
      (msgs) => msgs.some(
        (m) => m.type === "status" && m.sessionId === secondSession.sessionId,
      ),
    );

    const firstMarker = first.messages.length;
    const secondMarker = second.messages.length;
    ws2.send(JSON.stringify({
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

    const leakedToFirstSocket = first.messages.slice(firstMarker).some(
      (m) =>
        m.type === "status" &&
        m.status === "busy" &&
        m.sessionId === secondSession.sessionId,
    );
    expect(leakedToFirstSocket).toBe(false);
    expect(getSessionById(wsId, firstSessionId)?.status).toBe("streaming");
    expect(getSessionById(wsId, secondSession.sessionId)?.status).toBe("streaming");

    ws1.close();
    ws2.close();
    await local.app.close();
    await endSession(wsId, dataDir).catch(() => {});
  });

  it("keeps workspace channels isolated across concurrent workspace streams", async () => {
    const otherWorkspace = await createWorkspace(projectId, dataDir);
    const first = connectSessionWs(wsId);
    const second = connectSessionWs(otherWorkspace.id);
    const ws1 = await first.wsReady;
    const ws2 = await second.wsReady;

    await waitForMessage(first.messages, (msgs) => msgs.some((m) => m.type === "status"));
    await waitForMessage(second.messages, (msgs) => msgs.some((m) => m.type === "status"));

    const secondStartCount = second.messages.length;
    ws1.send(JSON.stringify({ type: "user_message", content: "workspace-one-message" }));

    await waitForMessage(
      first.messages,
      (msgs) => msgs.some((m) => m.type === "user_message"),
    );
    await new Promise((resolve) => setTimeout(resolve, 150));

    const leakedToOtherWorkspace = second.messages.slice(secondStartCount).some(
      (m) => m.type === "user_message" || (m.type === "status" && m.status === "busy"),
    );
    expect(leakedToOtherWorkspace).toBe(false);

    ws1.close();
    ws2.close();
    await endSession(wsId, dataDir).catch(() => {});
    await endSession(otherWorkspace.id, dataDir).catch(() => {});
  });

  it("keeps a workspace channel until the last socket closes, then removes it", async () => {
    const first = connectSessionWs(wsId);
    const second = connectSessionWs(wsId);
    const ws1 = await first.wsReady;
    const ws2 = await second.wsReady;

    await waitForMessage(first.messages, (msgs) => msgs.some((m) => m.type === "status"));
    await waitForMessage(second.messages, (msgs) => msgs.some((m) => m.type === "status"));
    await waitForCondition(() => _getChannelsForTests().get(wsId)?.sockets.size === 2);

    ws1.close();
    await waitForCondition(() => _getChannelsForTests().get(wsId)?.sockets.size === 1);
    expect(_getChannelsForTests().has(wsId)).toBe(true);

    ws2.close();
    await waitForCondition(() => !_getChannelsForTests().has(wsId));
  });

  it("does not broadcast stale idle status when a session is replaced", async () => {
    const fakeClaudePath = join(tempDir, "fake-claude.sh");
    await writeFile(fakeClaudePath, "#!/bin/sh\nsleep 5\n", "utf-8");
    await chmod(fakeClaudePath, 0o755);

    const local = await startWsApp(undefined, { command: fakeClaudePath, systemPrompt: false });
    const { wsReady, messages } = connectSessionWs(wsId, { address: local.address });
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.length >= 1);
    const idleStatusesBefore = messages.filter(
      (m) => m.type === "status" && m.status === "idle",
    ).length;

    ws.send(JSON.stringify({ type: "user_message", content: "replace me" }));
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
    const wsUrl = secure.address.replace("http://", "ws://");
    const ws = new WebSocket(`${wsUrl}/ws/session/${wsId}`);

    const closeCode = await new Promise<number>((resolve, reject) => {
      ws.on("close", (code) => resolve(code));
      ws.on("error", reject);
    });

    expect(closeCode).toBe(1008);
    await secure.app.close();
  });

  it("accepts websocket connections with a valid auth token", async () => {
    const secure = await startWsApp("secret");
    const { wsReady, messages } = connectSessionWs(wsId, {
      address: secure.address,
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
    const wsUrl = secure.address.replace("http://", "ws://");
    const messages: WsOutgoing[] = [];
    const ws = new WebSocket(`${wsUrl}/ws/session/${wsId}?token=secret`);
    ws.on("message", (data) => {
      messages.push(JSON.parse(data.toString()) as WsOutgoing);
    });

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });

    await waitForMessage(messages, (msgs) => msgs.length >= 1);
    expect(messages[0]).toEqual({ type: "status", status: "idle", streaming: false });

    ws.close();
    await secure.app.close();
  });

  it("broadcastToWorkspace sends a message to all connected sockets", async () => {
    const first = connectSessionWs(wsId);
    const second = connectSessionWs(wsId);
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
    // Should not throw
    broadcastToWorkspace("ws-nonexistent", {
      type: "branch_info",
      info: { name: "test", lastSyncedAt: "2026-02-13T00:00:00.000Z" },
    });
  });

  it("sends cached branch_info and diff_stats on connect", async () => {
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
    const localWsUrl = local.address.replace("http://", "ws://");
    const messages: WsOutgoing[] = [];
    const ws = new WebSocket(`${localWsUrl}/ws/session/${wsId}`);
    ws.on("message", (data) => {
      messages.push(JSON.parse(data.toString()) as WsOutgoing);
    });

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });

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

  it("does not send snapshots when provider returns undefined for workspace", async () => {
    const provider = {
      getCachedBranchInfo: vi.fn(() => undefined),
      getCachedDiffStats: vi.fn(() => undefined),
    };
    const local = await startWsApp(undefined, CONV_CMD, provider);
    const { wsReady, messages } = connectSessionWs(wsId, { address: local.address });
    const ws = await wsReady;

    await waitForMessage(messages, (msgs) => msgs.some((m) => m.type === "status"));
    // Give a small window for any extra messages to arrive
    await new Promise((r) => setTimeout(r, 100));

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: "status", status: "idle", streaming: false });
    expect(messages.some((m) => m.type === "branch_info")).toBe(false);
    expect(messages.some((m) => m.type === "diff_stats")).toBe(false);

    ws.close();
    await local.app.close();
  });

  it("sends snapshots after busy status when session exists", async () => {
    const branchInfo = { name: "workspace/tokyo", lastSyncedAt: "2026-02-15T10:00:00.000Z" };
    const diffStats = { committed: [], uncommitted: [] };
    const provider = {
      getCachedBranchInfo: vi.fn((id: string) => (id === wsId ? branchInfo : undefined)),
      getCachedDiffStats: vi.fn((id: string) => (id === wsId ? diffStats : undefined)),
    };
    const local = await startWsApp(undefined, CONV_CMD, provider);

    // Create a session first so the WS connect path hits the "busy" branch
    await getOrCreateSession(wsId, dataDir, CONV_CMD);

    const { wsReady, messages } = connectSessionWs(wsId, { address: local.address });
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
});
