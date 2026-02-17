import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { conductorRoutes } from "./conductor.js";

let tempDir: string;
let previousDataDir: string | undefined;
let previousConductorDbPath: string | undefined;
let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "hive-conductor-api-test-"));
  previousDataDir = process.env.DATA_DIR;
  previousConductorDbPath = process.env.CONDUCTOR_DB_PATH;
  process.env.DATA_DIR = tempDir;

  app = Fastify();
  await app.register((instance: FastifyInstance) => conductorRoutes(instance));
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();

  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  if (previousConductorDbPath === undefined) delete process.env.CONDUCTOR_DB_PATH;
  else process.env.CONDUCTOR_DB_PATH = previousConductorDbPath;
});

describe("conductor routes", () => {
  describe("GET /api/conductor/scan", () => {
    it("returns found=false when Conductor DB does not exist", async () => {
      process.env.CONDUCTOR_DB_PATH = join(tempDir, "nonexistent.db");

      const res = await app.inject({
        method: "GET",
        url: "/api/conductor/scan",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.found).toBe(false);
      expect(body.projects).toEqual([]);
    });

    it("returns scan results for valid Conductor DB", async () => {
      const dbPath = join(tempDir, "conductor.db");
      createTestConductorDb(dbPath);
      process.env.CONDUCTOR_DB_PATH = dbPath;

      const res = await app.inject({
        method: "GET",
        url: "/api/conductor/scan",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.found).toBe(true);
      expect(body.projects).toHaveLength(1);
      expect(body.projects[0].name).toBe("test-repo");
      expect(body.totals.workspaces).toBe(1);
      expect(body.totals.sessions).toBe(1);
    });
  });

  describe("POST /api/conductor/import", () => {
    it("streams NDJSON progress events", async () => {
      const dbPath = join(tempDir, "conductor.db");
      createEmptyConductorDb(dbPath);
      process.env.CONDUCTOR_DB_PATH = dbPath;

      const res = await app.inject({
        method: "POST",
        url: "/api/conductor/import",
      });

      // The response is raw NDJSON, so check for expected content
      const body = res.body;
      const lines = body.trim().split("\n").filter(Boolean);

      expect(lines.length).toBeGreaterThanOrEqual(2);
      expect(JSON.parse(lines[0])).toMatchObject({ type: "start" });
      expect(JSON.parse(lines[lines.length - 1])).toMatchObject({ type: "done" });
    });
  });
});

function createEmptyConductorDb(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE repos (
      id TEXT PRIMARY KEY, remote_url TEXT, name TEXT, default_branch TEXT DEFAULT 'main',
      root_path TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY, repository_id TEXT, directory_name TEXT, branch TEXT,
      state TEXT DEFAULT 'active', active_session_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, workspace_id TEXT, status TEXT DEFAULT 'idle',
      title TEXT DEFAULT 'Untitled', claude_session_id TEXT, model TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE session_messages (
      id TEXT PRIMARY KEY, session_id TEXT, role TEXT, content TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), sent_at TEXT,
      cancelled_at TEXT, turn_id TEXT
    );
  `);
  db.close();
}

function createTestConductorDb(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE repos (
      id TEXT PRIMARY KEY, remote_url TEXT, name TEXT, default_branch TEXT DEFAULT 'main',
      root_path TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY, repository_id TEXT, directory_name TEXT, branch TEXT,
      state TEXT DEFAULT 'active', active_session_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, workspace_id TEXT, status TEXT DEFAULT 'idle',
      title TEXT DEFAULT 'Untitled', claude_session_id TEXT, model TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE session_messages (
      id TEXT PRIMARY KEY, session_id TEXT, role TEXT, content TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), sent_at TEXT,
      cancelled_at TEXT, turn_id TEXT
    );
  `);

  db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))")
    .run("repo-1", "https://github.com/test/test-repo.git", "test-repo", "main", null);

  db.prepare("INSERT INTO workspaces VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))")
    .run("ws-1", "repo-1", "montpellier", "main", "active", null);

  db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))")
    .run("sess-1", "ws-1", "idle", "Test Session", "claude-1", "opus");

  db.prepare("INSERT INTO session_messages VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), NULL, ?)")
    .run("msg-1", "sess-1", "user", JSON.stringify({ content: "Hello" }), "t-1");

  db.prepare("INSERT INTO session_messages VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), NULL, ?)")
    .run("msg-2", "sess-1", "assistant", JSON.stringify({
      type: "assistant", message: { content: [{ type: "text", text: "Hi!" }] },
    }), "t-1");

  db.close();
}
