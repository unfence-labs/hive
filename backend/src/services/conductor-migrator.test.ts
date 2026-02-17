import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import {
  convertConductorMessages,
  scanConductor,
  importFromConductor,
  type ImportProgressEvent,
} from "./conductor-migrator.js";

// ── convertConductorMessages tests ──────────────────────────────────

describe("convertConductorMessages", () => {
  it("converts a simple user message", () => {
    const messages = [
      {
        id: "msg-1",
        session_id: "s-1",
        role: "user",
        content: JSON.stringify({ content: "Hello world" }),
        created_at: "2025-01-01T00:00:00Z",
        sent_at: "2025-01-01T00:00:01Z",
        cancelled_at: null,
        turn_id: "t-1",
      },
    ];

    const result = convertConductorMessages(messages, "test-session");

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toBe("Hello world");
    expect(result[0].sessionId).toBe("test-session");
    expect(result[0].timestamp).toBe("2025-01-01T00:00:01Z");
  });

  it("converts an assistant message with text content", () => {
    const messages = [
      {
        id: "msg-1",
        session_id: "s-1",
        role: "assistant",
        content: JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Hello from Claude" }],
          },
        }),
        created_at: "2025-01-01T00:00:00Z",
        sent_at: "2025-01-01T00:00:02Z",
        cancelled_at: null,
        turn_id: "t-1",
      },
    ];

    const result = convertConductorMessages(messages, "test-session");

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("assistant");
    expect(result[0].content).toBe("Hello from Claude");
  });

  it("extracts thinking content from assistant messages", () => {
    const messages = [
      {
        id: "msg-1",
        session_id: "s-1",
        role: "assistant",
        content: JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "thinking", thinking: "Let me think..." },
              { type: "text", text: "Here is my answer" },
            ],
          },
        }),
        created_at: "2025-01-01T00:00:00Z",
        sent_at: null,
        cancelled_at: null,
        turn_id: "t-1",
      },
    ];

    const result = convertConductorMessages(messages, "test-session");

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Here is my answer");
    expect(result[0].thinkingContent).toBe("Let me think...");
  });

  it("extracts tool calls from assistant messages", () => {
    const messages = [
      {
        id: "msg-1",
        session_id: "s-1",
        role: "assistant",
        content: JSON.stringify({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "toolu_1",
                name: "Bash",
                input: { command: "ls -la" },
              },
            ],
          },
        }),
        created_at: "2025-01-01T00:00:00Z",
        sent_at: null,
        cancelled_at: null,
        turn_id: "t-1",
      },
    ];

    const result = convertConductorMessages(messages, "test-session");

    expect(result).toHaveLength(1);
    expect(result[0].toolCalls).toHaveLength(1);
    expect(result[0].toolCalls![0].name).toBe("Bash");
    expect(result[0].toolCalls![0].id).toBe("toolu_1");
    expect(JSON.parse(result[0].toolCalls![0].input)).toEqual({ command: "ls -la" });
  });

  it("attaches tool_result outputs to tool calls", () => {
    const messages = [
      {
        id: "msg-1",
        session_id: "s-1",
        role: "assistant",
        content: JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "echo hi" } },
            ],
          },
        }),
        created_at: "2025-01-01T00:00:00Z",
        sent_at: null,
        cancelled_at: null,
        turn_id: "t-1",
      },
      {
        id: "msg-2",
        session_id: "s-1",
        role: "user",
        content: JSON.stringify({
          type: "tool_result",
          tool_use_id: "toolu_1",
          content: "hi\n",
        }),
        created_at: "2025-01-01T00:00:01Z",
        sent_at: null,
        cancelled_at: null,
        turn_id: "t-1",
      },
    ];

    const result = convertConductorMessages(messages, "test-session");

    expect(result).toHaveLength(1);
    expect(result[0].toolCalls![0].output).toBe("hi\n");
  });

  it("attaches tool_result from array-format user messages", () => {
    const messages = [
      {
        id: "msg-1",
        session_id: "s-1",
        role: "assistant",
        content: JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", id: "toolu_1", name: "Read", input: { file: "test.ts" } },
            ],
          },
        }),
        created_at: "2025-01-01T00:00:00Z",
        sent_at: null,
        cancelled_at: null,
        turn_id: "t-1",
      },
      {
        id: "msg-2",
        session_id: "s-1",
        role: "user",
        content: JSON.stringify({
          content: [
            { type: "tool_result", tool_use_id: "toolu_1", content: "file contents here" },
          ],
        }),
        created_at: "2025-01-01T00:00:01Z",
        sent_at: null,
        cancelled_at: null,
        turn_id: "t-1",
      },
    ];

    const result = convertConductorMessages(messages, "test-session");

    expect(result).toHaveLength(1);
    expect(result[0].toolCalls![0].output).toBe("file contents here");
  });

  it("attaches duration from result messages", () => {
    const messages = [
      {
        id: "msg-1",
        session_id: "s-1",
        role: "assistant",
        content: JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Done" }] },
        }),
        created_at: "2025-01-01T00:00:00Z",
        sent_at: null,
        cancelled_at: null,
        turn_id: "t-1",
      },
      {
        id: "msg-2",
        session_id: "s-1",
        role: null,
        content: JSON.stringify({
          type: "result",
          duration_ms: 5000,
          total_cost_usd: 0.1,
        }),
        created_at: "2025-01-01T00:00:05Z",
        sent_at: null,
        cancelled_at: null,
        turn_id: "t-1",
      },
    ];

    const result = convertConductorMessages(messages, "test-session");

    expect(result).toHaveLength(1);
    expect(result[0].durationMs).toBe(5000);
  });

  it("skips system init messages", () => {
    const messages = [
      {
        id: "msg-0",
        session_id: "s-1",
        role: null,
        content: JSON.stringify({
          type: "system",
          subtype: "init",
          tools: [],
        }),
        created_at: "2025-01-01T00:00:00Z",
        sent_at: null,
        cancelled_at: null,
        turn_id: null,
      },
      {
        id: "msg-1",
        session_id: "s-1",
        role: "user",
        content: JSON.stringify({ content: "Hello" }),
        created_at: "2025-01-01T00:00:01Z",
        sent_at: null,
        cancelled_at: null,
        turn_id: "t-1",
      },
    ];

    const result = convertConductorMessages(messages, "test-session");

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toBe("Hello");
  });

  it("handles a full multi-turn conversation", () => {
    const messages = [
      // System init (skip)
      {
        id: "msg-0", session_id: "s-1", role: null,
        content: JSON.stringify({ type: "system", subtype: "init" }),
        created_at: "2025-01-01T00:00:00Z", sent_at: null, cancelled_at: null, turn_id: null,
      },
      // User message
      {
        id: "msg-1", session_id: "s-1", role: "user",
        content: JSON.stringify({ content: "Fix the bug in main.ts" }),
        created_at: "2025-01-01T00:00:01Z", sent_at: "2025-01-01T00:00:01Z", cancelled_at: null, turn_id: "t-1",
      },
      // Assistant with tool use
      {
        id: "msg-2", session_id: "s-1", role: "assistant",
        content: JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "thinking", thinking: "Let me read the file first" },
              { type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "main.ts" } },
            ],
          },
        }),
        created_at: "2025-01-01T00:00:02Z", sent_at: null, cancelled_at: null, turn_id: "t-1",
      },
      // Tool result
      {
        id: "msg-3", session_id: "s-1", role: "user",
        content: JSON.stringify({ type: "tool_result", tool_use_id: "toolu_1", content: "const x = 1;" }),
        created_at: "2025-01-01T00:00:03Z", sent_at: null, cancelled_at: null, turn_id: "t-1",
      },
      // Assistant final response
      {
        id: "msg-4", session_id: "s-1", role: "assistant",
        content: JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "I found and fixed the bug." }],
          },
        }),
        created_at: "2025-01-01T00:00:04Z", sent_at: null, cancelled_at: null, turn_id: "t-1",
      },
      // Result
      {
        id: "msg-5", session_id: "s-1", role: null,
        content: JSON.stringify({ type: "result", duration_ms: 12000 }),
        created_at: "2025-01-01T00:00:05Z", sent_at: null, cancelled_at: null, turn_id: "t-1",
      },
    ];

    const result = convertConductorMessages(messages, "test-session");

    expect(result).toHaveLength(3);
    // User message
    expect(result[0].role).toBe("user");
    expect(result[0].content).toBe("Fix the bug in main.ts");
    // Assistant with tool call
    expect(result[1].role).toBe("assistant");
    expect(result[1].thinkingContent).toBe("Let me read the file first");
    expect(result[1].toolCalls).toHaveLength(1);
    expect(result[1].toolCalls![0].output).toBe("const x = 1;");
    // Final assistant
    expect(result[2].role).toBe("assistant");
    expect(result[2].content).toBe("I found and fixed the bug.");
    expect(result[2].durationMs).toBe(12000);
  });

  it("returns empty array for empty input", () => {
    expect(convertConductorMessages([], "test")).toEqual([]);
  });

  it("skips messages with null content", () => {
    const messages = [
      {
        id: "msg-1", session_id: "s-1", role: "user",
        content: null,
        created_at: "2025-01-01T00:00:00Z", sent_at: null, cancelled_at: null, turn_id: null,
      },
    ];
    expect(convertConductorMessages(messages, "test")).toEqual([]);
  });

  it("skips messages with invalid JSON content", () => {
    const messages = [
      {
        id: "msg-1", session_id: "s-1", role: "user",
        content: "not json",
        created_at: "2025-01-01T00:00:00Z", sent_at: null, cancelled_at: null, turn_id: null,
      },
    ];
    expect(convertConductorMessages(messages, "test")).toEqual([]);
  });
});

// ── Scan & Import integration tests ─────────────────────────────────

describe("scanConductor", () => {
  let tempDir: string;
  let previousDataDir: string | undefined;
  let previousConductorDbPath: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hive-conductor-test-"));
    previousDataDir = process.env.DATA_DIR;
    previousConductorDbPath = process.env.CONDUCTOR_DB_PATH;
    process.env.DATA_DIR = tempDir;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    if (previousConductorDbPath === undefined) delete process.env.CONDUCTOR_DB_PATH;
    else process.env.CONDUCTOR_DB_PATH = previousConductorDbPath;
  });

  it("returns found=false when DB does not exist", async () => {
    process.env.CONDUCTOR_DB_PATH = join(tempDir, "nonexistent.db");

    const result = await scanConductor(tempDir);

    expect(result.found).toBe(false);
    expect(result.projects).toEqual([]);
  });

  it("scans a Conductor DB and returns project summaries", async () => {
    const dbPath = join(tempDir, "conductor.db");
    createTestConductorDb(dbPath);
    process.env.CONDUCTOR_DB_PATH = dbPath;

    const result = await scanConductor(tempDir);

    expect(result.found).toBe(true);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].name).toBe("test-repo");
    expect(result.projects[0].remoteUrl).toBe("https://github.com/test/test-repo.git");
    expect(result.projects[0].workspaceCount).toBe(1);
    expect(result.projects[0].sessionCount).toBe(1);
    expect(result.projects[0].messageCount).toBe(2);
    expect(result.projects[0].alreadyImported).toBe(false);
    expect(result.totals.projects).toBe(1);
    expect(result.totals.workspaces).toBe(1);
  });

  it("marks projects as alreadyImported when Hive already has the same URL", async () => {
    const dbPath = join(tempDir, "conductor.db");
    createTestConductorDb(dbPath);
    process.env.CONDUCTOR_DB_PATH = dbPath;

    // Create a Hive project with the same URL
    const projectDir = join(tempDir, "proj-existing");
    await mkdir(projectDir, { recursive: true });
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(
      join(projectDir, "state.json"),
      JSON.stringify({
        id: "proj-existing",
        name: "test-repo",
        url: "https://github.com/test/test-repo.git",
        createdAt: "2025-01-01T00:00:00Z",
        workspaces: [],
      }),
    );

    const result = await scanConductor(tempDir);

    expect(result.projects[0].alreadyImported).toBe(true);
  });
});

describe("importFromConductor", () => {
  let tempDir: string;
  let previousDataDir: string | undefined;
  let previousConductorDbPath: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hive-conductor-import-test-"));
    previousDataDir = process.env.DATA_DIR;
    previousConductorDbPath = process.env.CONDUCTOR_DB_PATH;
    process.env.DATA_DIR = tempDir;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    if (previousConductorDbPath === undefined) delete process.env.CONDUCTOR_DB_PATH;
    else process.env.CONDUCTOR_DB_PATH = previousConductorDbPath;
  });

  it("emits start and done events for empty DB", async () => {
    const dbPath = join(tempDir, "conductor.db");
    createEmptyConductorDb(dbPath);
    process.env.CONDUCTOR_DB_PATH = dbPath;

    const events: ImportProgressEvent[] = [];
    await importFromConductor((e) => events.push(e), tempDir);

    expect(events[0]).toEqual({ type: "start", totalProjects: 0, totalWorkspaces: 0 });
    expect(events[events.length - 1]).toMatchObject({ type: "done" });
  });

  it("imports sessions and writes messages.jsonl and metadata.json", async () => {
    const dbPath = join(tempDir, "conductor.db");
    const fixtureRepo = await createFixtureGitRepo(tempDir);
    createTestConductorDb(dbPath, fixtureRepo);
    process.env.CONDUCTOR_DB_PATH = dbPath;

    const events: ImportProgressEvent[] = [];
    const result = await importFromConductor((e) => events.push(e), tempDir);

    expect(result.sessions).toBe(1);

    // Find the project directory
    const { readdir: rd } = await import("node:fs/promises");
    const entries = await rd(tempDir, { withFileTypes: true });
    const projDir = entries.find((e) => e.isDirectory() && e.name.startsWith("proj-"));
    expect(projDir).toBeTruthy();

    // Check sessions directory
    const sessionsDir = join(tempDir, projDir!.name, "sessions");
    const sessionEntries = await rd(sessionsDir, { withFileTypes: true });
    expect(sessionEntries.length).toBeGreaterThan(0);

    // Check messages.jsonl
    const sessionDir = join(sessionsDir, sessionEntries[0].name);
    const messagesRaw = await readFile(join(sessionDir, "messages.jsonl"), "utf-8");
    const messages = messagesRaw.trim().split("\n").map((l) => JSON.parse(l));
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("Hello world");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toBe("Hi there!");

    // Check metadata.json
    const metaRaw = await readFile(join(sessionDir, "metadata.json"), "utf-8");
    const meta = JSON.parse(metaRaw);
    expect(meta.messageCount).toBe(2);
    expect(meta.title).toBe("Test Session");
  });

  it("emits progress events in correct order", async () => {
    const dbPath = join(tempDir, "conductor.db");
    const fixtureRepo = await createFixtureGitRepo(tempDir);
    createTestConductorDb(dbPath, fixtureRepo);
    process.env.CONDUCTOR_DB_PATH = dbPath;

    const eventTypes: string[] = [];
    await importFromConductor((e) => eventTypes.push(e.type), tempDir);

    expect(eventTypes[0]).toBe("start");
    expect(eventTypes).toContain("project_start");
    expect(eventTypes).toContain("project_cloning");
    expect(eventTypes).toContain("project_cloned");
    expect(eventTypes).toContain("workspace_importing");
    expect(eventTypes).toContain("workspace_imported");
    expect(eventTypes).toContain("project_done");
    expect(eventTypes[eventTypes.length - 1]).toBe("done");
  });
});

// ── Test helpers ────────────────────────────────────────────────────

function createEmptyConductorDb(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE repos (
      id TEXT PRIMARY KEY,
      remote_url TEXT,
      name TEXT,
      default_branch TEXT DEFAULT 'main',
      root_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      repository_id TEXT,
      directory_name TEXT,
      branch TEXT,
      state TEXT DEFAULT 'active',
      active_session_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT,
      status TEXT DEFAULT 'idle',
      title TEXT DEFAULT 'Untitled',
      claude_session_id TEXT,
      model TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE session_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      role TEXT,
      content TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      sent_at TEXT,
      cancelled_at TEXT,
      turn_id TEXT
    );
  `);
  db.close();
}

function createTestConductorDb(dbPath: string, localRepoPath?: string): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE repos (
      id TEXT PRIMARY KEY,
      remote_url TEXT,
      name TEXT,
      default_branch TEXT DEFAULT 'main',
      root_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      repository_id TEXT,
      directory_name TEXT,
      branch TEXT,
      state TEXT DEFAULT 'active',
      active_session_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT,
      status TEXT DEFAULT 'idle',
      title TEXT DEFAULT 'Untitled',
      claude_session_id TEXT,
      model TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE session_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      role TEXT,
      content TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      sent_at TEXT,
      cancelled_at TEXT,
      turn_id TEXT
    );
  `);

  db.prepare(`INSERT INTO repos (id, remote_url, name, default_branch, root_path, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run("repo-1", localRepoPath ?? "https://github.com/test/test-repo.git", "test-repo", "main", localRepoPath ?? null, "2025-01-01T00:00:00Z");

  db.prepare(`INSERT INTO workspaces (id, repository_id, directory_name, branch, state, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run("ws-1", "repo-1", "montpellier", "main", "active", "2025-01-01T00:00:00Z");

  db.prepare(`INSERT INTO sessions (id, workspace_id, title, claude_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run("sess-1", "ws-1", "Test Session", "claude-sess-1", "2025-01-01T00:00:00Z", "2025-01-01T00:01:00Z");

  db.prepare(`INSERT INTO session_messages (id, session_id, role, content, created_at, sent_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run("msg-1", "sess-1", "user", JSON.stringify({ content: "Hello world" }), "2025-01-01T00:00:01Z", "2025-01-01T00:00:01Z");

  db.prepare(`INSERT INTO session_messages (id, session_id, role, content, created_at, sent_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run("msg-2", "sess-1", "assistant", JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Hi there!" }] },
    }), "2025-01-01T00:00:02Z", "2025-01-01T00:00:02Z");

  db.close();
}

async function createFixtureGitRepo(parentDir: string): Promise<string> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);

  const repoDir = join(parentDir, "fixture-repo");
  await mkdir(repoDir, { recursive: true });

  await exec("git", ["init", "-b", "main"], { cwd: repoDir });
  await exec("git", ["config", "user.email", "test@test.com"], { cwd: repoDir });
  await exec("git", ["config", "user.name", "Test"], { cwd: repoDir });

  const { writeFile: wf } = await import("node:fs/promises");
  await wf(join(repoDir, "README.md"), "# Test\n");
  await exec("git", ["add", "."], { cwd: repoDir });
  await exec("git", ["commit", "-m", "Initial commit"], { cwd: repoDir });

  return repoDir;
}
