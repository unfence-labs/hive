import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir, createFixtureRepo } from "../utils/test-helpers.js";
import { projectRoutes } from "./projects.js";
import { workspaceRoutes } from "./workspaces.js";
import { sessionRoutes } from "./agents.js";
import { _clearActiveSessions } from "../agents/agent-manager.js";

const CONV_CMD = { command: "bash" };

let tempDir: string;
let dataDir: string;
let app: ReturnType<typeof Fastify>;
let projectId: string;
let wsId: string;

beforeEach(async () => {
  tempDir = await createTempDir("hive-api-session-test-");
  dataDir = join(tempDir, "data");
  const fixtureDir = join(tempDir, "fixtures");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dataDir, { recursive: true });
  await mkdir(fixtureDir, { recursive: true });
  const fixtureRepoUrl = await createFixtureRepo(fixtureDir);

  app = Fastify();
  await app.register((instance: FastifyInstance) => projectRoutes(instance, dataDir));
  await app.register((instance: FastifyInstance) => workspaceRoutes(instance, dataDir));
  await app.register((instance: FastifyInstance) =>
    sessionRoutes(instance, { dataDir, sessionOptions: CONV_CMD }),
  );
  await app.ready();

  const projRes = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: { url: fixtureRepoUrl },
  });
  projectId = projRes.json().id;

  const wsRes = await app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/workspaces`,
  });
  wsId = wsRes.json().id;
});

afterEach(async () => {
  _clearActiveSessions();
  await new Promise((r) => setTimeout(r, 50));
  await app.close();
  await rm(tempDir, { recursive: true, force: true });
});

async function writeSessionFixture(
  sessionId: string,
  workspaceId: string,
  options?: {
    updatedAt?: string;
    messageCount?: number;
    messages?: Array<Record<string, unknown> | string>;
  },
) {
  const sessionDir = join(dataDir, projectId, "sessions", sessionId);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    join(sessionDir, "metadata.json"),
    JSON.stringify({
      sessionId,
      workspaceId,
      createdAt: "2026-02-11T00:00:00.000Z",
      updatedAt: options?.updatedAt ?? "2026-02-11T00:00:01.000Z",
      messageCount: options?.messageCount ?? 0,
    }),
    "utf-8",
  );

  if (options?.messages) {
    const content = options.messages
      .map((message) => typeof message === "string" ? message : JSON.stringify(message))
      .join("\n");
    await writeFile(join(sessionDir, "messages.jsonl"), content + "\n", "utf-8");
  }
}

describe("POST /api/workspaces/:wsId/session", () => {
  it("creates a session and returns 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/session`,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.sessionId).toBeTruthy();
    expect(body.workspaceId).toBe(wsId);
  });

  it("returns 200 for existing session", async () => {
    await app.inject({ method: "POST", url: `/api/workspaces/${wsId}/session` });

    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/session`,
    });
    expect(res.statusCode).toBe(200);
  });

  it("handles concurrent create calls when session already exists", async () => {
    const first = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/session`,
    });
    expect(first.statusCode).toBe(201);
    const firstSessionId = first.json().sessionId;

    const [resA, resB] = await Promise.all([
      app.inject({ method: "POST", url: `/api/workspaces/${wsId}/session` }),
      app.inject({ method: "POST", url: `/api/workspaces/${wsId}/session` }),
    ]);

    expect(resA.statusCode).toBe(200);
    expect(resB.statusCode).toBe(200);
    expect(resA.json().sessionId).toBe(firstSessionId);
    expect(resB.json().sessionId).toBe(firstSessionId);
  });

  it("handles concurrent create calls on a fresh workspace", async () => {
    const [resA, resB] = await Promise.all([
      app.inject({ method: "POST", url: `/api/workspaces/${wsId}/session` }),
      app.inject({ method: "POST", url: `/api/workspaces/${wsId}/session` }),
    ]);

    const statuses = [resA.statusCode, resB.statusCode].sort();
    expect(statuses).toEqual([200, 201]);
    expect(resA.json().sessionId).toBe(resB.json().sessionId);
  });

  it("returns 404 for non-existent workspace", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/workspaces/nonexistent/session",
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/workspaces/:wsId/session", () => {
  it("returns session metadata when active", async () => {
    await app.inject({ method: "POST", url: `/api/workspaces/${wsId}/session` });

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/session`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sessionId).toBeTruthy();
  });

  it("returns 404 when no session exists", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/session`,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/workspaces/:wsId/session/messages", () => {
  it("returns empty history for fresh session", async () => {
    await app.inject({ method: "POST", url: `/api/workspaces/${wsId}/session` });

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/session/messages`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ messages: [], hasMore: false });
  });

  it("returns empty history when no session exists", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/session/messages`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ messages: [], hasMore: false });
  });

  it("returns persisted messages after ending a session", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/session`,
    });
    const { sessionId } = createRes.json() as { sessionId: string };

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
        role: "user",
        content: "hello from disk",
        timestamp: "2026-02-11T00:00:00.000Z",
      }) + "\n",
      "utf-8",
    );

    await app.inject({ method: "DELETE", url: `/api/workspaces/${wsId}/session` });

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/session/messages`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      messages: [
        expect.objectContaining({
          content: "hello from disk",
          role: "user",
        }),
      ],
      hasMore: false,
    });
  });

  it("returns 404 for non-existent workspace", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/workspaces/nonexistent/session/messages",
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /api/workspaces/:wsId/session", () => {
  it("ends session and returns 204", async () => {
    await app.inject({ method: "POST", url: `/api/workspaces/${wsId}/session` });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/workspaces/${wsId}/session`,
    });
    expect(res.statusCode).toBe(204);

    // Workspace should be idle again
    const wsRes = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}`,
    });
    expect(wsRes.json().status).toBe("idle");
  });

  it("returns 204 when no session exists", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/workspaces/${wsId}/session`,
    });
    expect(res.statusCode).toBe(204);
  });

  it("allows creating a new session after ending one", async () => {
    await app.inject({ method: "POST", url: `/api/workspaces/${wsId}/session` });
    await app.inject({ method: "DELETE", url: `/api/workspaces/${wsId}/session` });

    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/session`,
    });
    expect(res.statusCode).toBe(201);
  });
});

describe("GET /api/workspaces/:wsId/sessions", () => {
  it("lists all sessions for a workspace", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/session`,
    });
    const activeSessionId = createRes.json().sessionId as string;
    await writeSessionFixture("persisted-1", wsId, {
      updatedAt: "2099-02-12T00:00:00.000Z",
      messageCount: 2,
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/sessions`,
    });

    expect(res.statusCode).toBe(200);
    const sessions = res.json() as Array<{ sessionId: string }>;
    expect(sessions.map((s) => s.sessionId)).toEqual([
      "persisted-1",
      activeSessionId,
    ]);
  });

  it("returns 404 for non-existent workspace", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/workspaces/missing/sessions",
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/workspaces/:wsId/sessions", () => {
  it("creates a new session even when one is already active", async () => {
    const firstRes = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/session`,
    });
    const firstSessionId = firstRes.json().sessionId as string;

    const secondRes = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/sessions`,
    });

    expect(secondRes.statusCode).toBe(201);
    const secondSessionId = secondRes.json().sessionId as string;
    expect(secondSessionId).not.toBe(firstSessionId);

    const metaRes = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/session`,
    });
    expect(metaRes.statusCode).toBe(200);
    expect(metaRes.json().sessionId).toBe(secondSessionId);
  });
});

describe("POST /api/workspaces/:wsId/sessions/:sessionId/activate", () => {
  it("returns 404 because activation is handled over websocket switch_session", async () => {
    await writeSessionFixture("sess-activate", wsId, { messageCount: 3 });

    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/sessions/sess-activate/activate`,
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /api/workspaces/:wsId/sessions/:sessionId", () => {
  it("hard deletes an inactive session", async () => {
    await writeSessionFixture("sess-delete", wsId);

    const res = await app.inject({
      method: "DELETE",
      url: `/api/workspaces/${wsId}/sessions/sess-delete`,
    });

    expect(res.statusCode).toBe(204);

    const listRes = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/sessions`,
    });
    expect(listRes.json()).toEqual([]);
  });

  it("hard deletes an active session and marks workspace idle", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/session`,
    });
    const sessionId = createRes.json().sessionId as string;

    const res = await app.inject({
      method: "DELETE",
      url: `/api/workspaces/${wsId}/sessions/${sessionId}`,
    });
    expect(res.statusCode).toBe(204);

    const wsRes = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}`,
    });
    expect(wsRes.json().status).toBe("idle");
    expect(wsRes.json().activeSessionId).toBeUndefined();
  });
});

describe("GET /api/workspaces/:wsId/sessions/:sessionId/messages", () => {
  it("returns messages from a specific persisted session", async () => {
    await writeSessionFixture("sess-msgs", wsId, {
      messages: [
        {
          id: "m-1",
          sessionId: "sess-msgs",
          role: "user",
          content: "hello specific",
          timestamp: "2026-02-11T00:00:00.000Z",
        },
        "not-json-line",
        {
          id: "m-2",
          sessionId: "sess-msgs",
          role: "assistant",
          content: "response specific",
          timestamp: "2026-02-11T00:00:01.000Z",
        },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/sessions/sess-msgs/messages`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      messages: [
        expect.objectContaining({ id: "m-1", content: "hello specific", role: "user" }),
        expect.objectContaining({ id: "m-2", content: "response specific", role: "assistant" }),
      ],
      hasMore: false,
    });
  });

  it("404s when the specific session does not exist (no existence leak)", async () => {
    // A missing session and a session owned by another workspace are
    // indistinguishable: both 404 so a sibling workspace can't be probed.
    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/sessions/missing/messages`,
    });
    expect(res.statusCode).toBe(404);
  });
});

// ── PRD #254: lazy-output truncation, pagination, and expand ─────────

type HistoryResponse = {
  messages: Array<Record<string, unknown> & {
    id: string;
    toolCalls?: Array<Record<string, unknown>>;
    agentActivities?: Array<Record<string, unknown>>;
  }>;
  hasMore: boolean;
};

const BIG_OUTPUT = "x".repeat(5000); // > 2 KB cap
const SMALL_OUTPUT = "small output\nsecond line"; // < 2 KB cap

/** Build a session whose single assistant message carries heavy outputs. */
async function writeHeavySession(sessionId: string) {
  await writeSessionFixture(sessionId, wsId, {
    messages: [
      {
        id: "u-1",
        sessionId,
        role: "user",
        content: "run it",
        timestamp: "2026-02-11T00:00:00.000Z",
      },
      {
        id: "a-1",
        sessionId,
        role: "assistant",
        content: "done",
        timestamp: "2026-02-11T00:00:01.000Z",
        toolCalls: [
          { id: "tool-big", name: "Bash", input: "{}", output: BIG_OUTPUT },
          { id: "tool-small", name: "Read", input: "{}", output: SMALL_OUTPUT },
        ],
        agentActivities: [
          { id: "act-cmd-big", kind: "command_execution", command: "echo", output: BIG_OUTPUT },
        ],
      },
    ],
  });
}

describe("PRD #254 lazy tool/activity outputs (REST history)", () => {
  it("truncates a ToolCall output over 2 KB with preview + scalars and omits the body", async () => {
    await writeHeavySession("heavy-1");

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/sessions/heavy-1/messages`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as HistoryResponse;
    const assistant = body.messages.find((m) => m.id === "a-1");
    const big = assistant?.toolCalls?.find((t) => t.id === "tool-big") as Record<string, unknown>;

    expect(big.output).toBeUndefined();
    expect(big.outputTruncated).toBe(true);
    expect((big.outputPreview as string).length).toBeLessThanOrEqual(2048);
    expect((big.outputPreview as string).length).toBeGreaterThan(0);
    expect(big.outputByteLength).toBe(5000);
    expect(big.outputLineCount).toBe(1); // single line, no newlines
  });

  it("keeps a ToolCall output under 2 KB intact, untruncated, with scalars present", async () => {
    await writeHeavySession("heavy-2");

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/sessions/heavy-2/messages`,
    });
    const body = res.json() as HistoryResponse;
    const assistant = body.messages.find((m) => m.id === "a-1");
    const small = assistant?.toolCalls?.find((t) => t.id === "tool-small") as Record<string, unknown>;

    expect(small.output).toBe(SMALL_OUTPUT);
    expect(small.outputTruncated).toBe(false);
    expect(small.outputPreview).toBe(SMALL_OUTPUT);
    expect(small.outputByteLength).toBe(Buffer.byteLength(SMALL_OUTPUT, "utf-8"));
    expect(small.outputLineCount).toBe(2);
  });

  it("truncates a command_execution activity output mirroring the ToolCall sub-shape", async () => {
    await writeHeavySession("heavy-3");

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/sessions/heavy-3/messages`,
    });
    const body = res.json() as HistoryResponse;
    const assistant = body.messages.find((m) => m.id === "a-1");
    const cmd = assistant?.agentActivities?.find(
      (a) => a.id === "act-cmd-big",
    ) as Record<string, unknown>;

    expect(cmd.output).toBeUndefined();
    expect(cmd.outputTruncated).toBe(true);
    expect((cmd.outputPreview as string).length).toBeLessThanOrEqual(2048);
    expect(cmd.outputByteLength).toBe(5000);
    expect(cmd.outputLineCount).toBe(1);
  });

  it("passes a file_change activity through unchanged (diffs are not truncated)", async () => {
    await writeSessionFixture("heavy-4", wsId, {
      messages: [
        {
          id: "a-1",
          sessionId: "heavy-4",
          role: "assistant",
          content: "done",
          timestamp: "2026-02-11T00:00:01.000Z",
          agentActivities: [
            {
              id: "act-file-big",
              kind: "file_change",
              files: [{ path: "src/a.ts", diff: BIG_OUTPUT }],
            },
          ],
        },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/sessions/heavy-4/messages`,
    });
    const body = res.json() as HistoryResponse;
    const assistant = body.messages.find((m) => m.id === "a-1");
    const fileChange = assistant?.agentActivities?.find(
      (a) => a.id === "act-file-big",
    ) as Record<string, unknown>;
    const file = (fileChange.files as Array<Record<string, unknown>>)[0];

    // The full diff is kept intact; no diff* truncation fields are emitted.
    expect(file.diff).toBe(BIG_OUTPUT);
    expect(file.diffPreview).toBeUndefined();
    expect(file.diffTruncated).toBeUndefined();
    expect(file.diffByteLength).toBeUndefined();
    expect(file.diffLineCount).toBeUndefined();
  });

  it("truncates a multibyte output on a UTF-8 char boundary (no split chars)", async () => {
    // 1000 × "é" (2 bytes each) = 2000 bytes < cap; pad past 2 KB with more é.
    const multibyte = "é".repeat(1200); // 2400 bytes > cap
    await writeSessionFixture("heavy-mb", wsId, {
      messages: [
        {
          id: "a-mb",
          sessionId: "heavy-mb",
          role: "assistant",
          content: "",
          timestamp: "2026-02-11T00:00:01.000Z",
          toolCalls: [{ id: "t-mb", name: "Bash", input: "{}", output: multibyte }],
        },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/sessions/heavy-mb/messages`,
    });
    const body = res.json() as HistoryResponse;
    const tool = body.messages[0].toolCalls?.[0] as Record<string, unknown>;
    const preview = tool.outputPreview as string;

    // Preview must be valid UTF-8 with no replacement char, and ≤ cap bytes.
    expect(Buffer.byteLength(preview, "utf-8")).toBeLessThanOrEqual(2048);
    expect(preview).not.toContain("�");
    expect(preview.split("").every((c) => c === "é")).toBe(true);
    expect(tool.outputByteLength).toBe(2400);
  });

  it("does NOT alter the on-disk .jsonl (disk stays the source of truth)", async () => {
    await writeHeavySession("heavy-disk");
    const messagesPath = join(
      dataDir, projectId, "sessions", "heavy-disk", "messages.jsonl",
    );

    await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/sessions/heavy-disk/messages`,
    });

    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(messagesPath, "utf-8");
    // Full output for every heavy field is still on disk.
    expect(raw).toContain(BIG_OUTPUT);
    expect(raw).not.toContain("outputPreview");
  });
});

describe("PRD #254 history pagination (?limit / ?before / hasMore)", () => {
  /** Write a session with N user messages id=m-0..m-(N-1). */
  async function writeManyMessages(sessionId: string, count: number) {
    const messages = Array.from({ length: count }, (_, i) => ({
      id: `m-${i}`,
      sessionId,
      role: "user",
      content: `msg ${i}`,
      timestamp: `2026-02-11T00:00:${String(i).padStart(2, "0")}.000Z`,
    }));
    await writeSessionFixture(sessionId, wsId, { messages });
  }

  it("returns the last `limit` messages and hasMore at the truncation boundary", async () => {
    await writeManyMessages("page-1", 10);

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/sessions/page-1/messages?limit=3`,
    });
    const body = res.json() as HistoryResponse;
    expect(body.messages.map((m) => m.id)).toEqual(["m-7", "m-8", "m-9"]);
    expect(body.hasMore).toBe(true);
  });

  it("hasMore is false when the window reaches the start of history", async () => {
    await writeManyMessages("page-2", 3);

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/sessions/page-2/messages?limit=10`,
    });
    const body = res.json() as HistoryResponse;
    expect(body.messages.map((m) => m.id)).toEqual(["m-0", "m-1", "m-2"]);
    expect(body.hasMore).toBe(false);
  });

  it("?before returns the window immediately before the cursor (exclusive)", async () => {
    await writeManyMessages("page-3", 10);

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/sessions/page-3/messages?limit=3&before=m-5`,
    });
    const body = res.json() as HistoryResponse;
    expect(body.messages.map((m) => m.id)).toEqual(["m-2", "m-3", "m-4"]);
    expect(body.hasMore).toBe(true);
  });

  it("?before at the start of history yields hasMore false", async () => {
    await writeManyMessages("page-4", 10);

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/sessions/page-4/messages?limit=3&before=m-2`,
    });
    const body = res.json() as HistoryResponse;
    expect(body.messages.map((m) => m.id)).toEqual(["m-0", "m-1"]);
    expect(body.hasMore).toBe(false);
  });

  it("unknown ?before id yields an empty window and hasMore false", async () => {
    await writeManyMessages("page-5", 10);

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/sessions/page-5/messages?before=nope`,
    });
    const body = res.json() as HistoryResponse;
    expect(body.messages).toEqual([]);
    expect(body.hasMore).toBe(false);
  });

  it("active-session route returns the same { messages, hasMore } shape", async () => {
    // Park an active session, then verify the active route serializes via the
    // same handler. The newly-created session has no messages on disk yet.
    await app.inject({ method: "POST", url: `/api/workspaces/${wsId}/session` });

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/session/messages?limit=5`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("messages");
    expect(body).toHaveProperty("hasMore");
    expect(Array.isArray(body.messages)).toBe(true);
  });
});

describe("PRD #254 expand endpoint (full output on demand)", () => {
  it("returns the full untruncated output for a tool id", async () => {
    await writeHeavySession("exp-1");

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/sessions/exp-1/tools/tool-big/output`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ output: BIG_OUTPUT });
  });

  it("resolves a command_execution activity id to its full output", async () => {
    await writeHeavySession("exp-2");

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/sessions/exp-2/tools/act-cmd-big/output`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ output: BIG_OUTPUT });
  });

  it("does NOT resolve a file_change activity id (diffs are not truncated, so not expandable)", async () => {
    await writeSessionFixture("exp-3", wsId, {
      messages: [
        {
          id: "a-1",
          sessionId: "exp-3",
          role: "assistant",
          content: "done",
          timestamp: "2026-02-11T00:00:01.000Z",
          agentActivities: [
            {
              id: "act-file-big",
              kind: "file_change",
              files: [{ path: "src/a.ts", diff: BIG_OUTPUT }],
            },
          ],
        },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/sessions/exp-3/tools/act-file-big/output`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("404s on an unknown tool id", async () => {
    await writeHeavySession("exp-4");

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/sessions/exp-4/tools/does-not-exist/output`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("404s on an unknown session", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/sessions/no-such-session/tools/tool-big/output`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects a traversal attempt in the session id", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/sessions/..%2f..%2fsecret/tools/t/output`,
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── Cross-workspace ownership guard (audit P1, IDOR) ─────────────────
// Sessions of every workspace in a project share one `<projectId>/sessions/`
// directory. A request that pairs workspace A with a sessionId owned by
// workspace B (same project) must NOT read B's messages, tool output, or
// attachments — it must 404 indistinguishably from a missing session.
describe("explicit-session reads are scoped to the owning workspace", () => {
  /** Second workspace in the SAME project, owning a session with all read targets. */
  async function setupSibling(): Promise<{ wsB: string; sessionId: string; filename: string }> {
    const wsBRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/workspaces`,
    });
    const wsB = wsBRes.json().id as string;

    const sessionId = "sess-wsB";
    const filename = "secret.png";
    await writeSessionFixture(sessionId, wsB, {
      messages: [
        {
          id: "m-secret",
          sessionId,
          role: "user",
          content: "wsB private content",
          timestamp: "2026-02-11T00:00:00.000Z",
        },
        {
          id: "a-secret",
          sessionId,
          role: "assistant",
          content: "ok",
          timestamp: "2026-02-11T00:00:01.000Z",
          toolCalls: [{ id: "tool-secret", name: "Bash", input: "{}", output: BIG_OUTPUT }],
        },
      ],
    });

    const attachmentsDir = join(dataDir, projectId, "sessions", sessionId, "attachments");
    await mkdir(attachmentsDir, { recursive: true });
    await writeFile(join(attachmentsDir, filename), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    return { wsB, sessionId, filename };
  }

  it("returns 404 for messages, tool output, and attachments when read via a foreign workspace", async () => {
    const { sessionId, filename } = await setupSibling();

    const messagesRes = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/sessions/${sessionId}/messages`,
    });
    expect(messagesRes.statusCode).toBe(404);
    expect(JSON.stringify(messagesRes.json())).not.toContain("wsB private content");

    const toolRes = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/sessions/${sessionId}/tools/tool-secret/output`,
    });
    expect(toolRes.statusCode).toBe(404);
    expect(JSON.stringify(toolRes.json())).not.toContain(BIG_OUTPUT);

    const attachmentRes = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/sessions/${sessionId}/attachments/${filename}`,
    });
    expect(attachmentRes.statusCode).toBe(404);
  });

  it("still serves messages, tool output, and attachments to the owning workspace", async () => {
    const { wsB, sessionId, filename } = await setupSibling();

    const messagesRes = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsB}/sessions/${sessionId}/messages`,
    });
    expect(messagesRes.statusCode).toBe(200);
    expect((messagesRes.json() as HistoryResponse).messages.map((m) => m.id)).toEqual([
      "m-secret",
      "a-secret",
    ]);

    const toolRes = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsB}/sessions/${sessionId}/tools/tool-secret/output`,
    });
    expect(toolRes.statusCode).toBe(200);
    expect(toolRes.json()).toEqual({ output: BIG_OUTPUT });

    const attachmentRes = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsB}/sessions/${sessionId}/attachments/${filename}`,
    });
    expect(attachmentRes.statusCode).toBe(200);
    expect(attachmentRes.headers["content-type"]).toBe("image/png");
  });
});
