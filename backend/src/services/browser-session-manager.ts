import { EventEmitter } from "node:events";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import type { BrowserSessionState, BrowserStatusPayload } from "../types.js";

export interface BrowserSessionRecord {
  workspaceId: string;
  sessionId: string;
  agentBrowserSession: string;
  port: number;
  state: BrowserSessionState;
  streaming: boolean;
  createdAt: number;
  updatedAt: number;
  lastActiveAt?: number;
  url?: string;
  title?: string;
  error?: string;
}

export type BrowserSessionManagerEvent = {
  status: [workspaceId: string, status: BrowserStatusPayload];
};

const AGENT_BROWSER_COMMAND_PATTERN = /(^|[\s"'`;&|()])(?:npx\s+|pnpm\s+dlx\s+|bunx\s+)?agent-browser(?=$|[\s"'`;&|()])/i;
const AGENT_BROWSER_ENV_PATTERN = /\bAGENT_BROWSER_STREAM_PORT\b/;
const AGENT_BROWSER_STOP_PATTERN = /\bagent-browser\b(?:\s+--?[^\s]+(?:\s+\S+)?)*\s+(?:close|stream\s+disable)\b/i;

function keyFor(workspaceId: string, sessionId: string): string {
  return `${workspaceId}:${sessionId}`;
}

function buildStreamPath(workspaceId: string, sessionId: string): string {
  return `/ws/browser/${encodeURIComponent(workspaceId)}/${encodeURIComponent(sessionId)}`;
}

function sanitizeAgentBrowserSessionPart(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized.slice(0, 48) || "session";
}

function buildAgentBrowserSession(workspaceId: string, sessionId: string): string {
  return `hive-${sanitizeAgentBrowserSessionPart(workspaceId)}-${sanitizeAgentBrowserSessionPart(sessionId)}`.slice(0, 120);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractCommandText(input: string): string {
  try {
    const parsed = JSON.parse(input) as unknown;
    if (isObject(parsed) && typeof parsed.command === "string") {
      return parsed.command;
    }
  } catch {
    // Tool inputs are not guaranteed to be JSON.
  }
  return input;
}

function extractString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function extractActiveTab(tabs: unknown): { url?: string; title?: string } {
  if (!Array.isArray(tabs)) return {};
  const objects = tabs.filter(isObject);
  const active = objects.find((tab) => tab.active === true || tab.selected === true) ?? objects[0];
  if (!active) return {};
  return {
    url: extractString(active.url),
    title: extractString(active.title),
  };
}

async function allocateLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? (address as AddressInfo).port : 0;
  await new Promise<void>((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve());
  });
  if (!port) throw new Error("Failed to allocate browser stream port");
  return port;
}

export class BrowserSessionManager extends EventEmitter<BrowserSessionManagerEvent> {
  private readonly sessions = new Map<string, BrowserSessionRecord>();

  async ensureSession(workspaceId: string, sessionId: string): Promise<BrowserSessionRecord> {
    const key = keyFor(workspaceId, sessionId);
    const existing = this.sessions.get(key);
    if (existing && existing.state !== "closed") return existing;

    const now = Date.now();
    const created: BrowserSessionRecord = {
      workspaceId,
      sessionId,
      agentBrowserSession: buildAgentBrowserSession(workspaceId, sessionId),
      port: await allocateLoopbackPort(),
      state: "registered",
      streaming: false,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(key, created);
    return created;
  }

  getSession(workspaceId: string, sessionId: string): BrowserSessionRecord | undefined {
    const session = this.sessions.get(keyFor(workspaceId, sessionId));
    if (!session || session.state === "closed") return undefined;
    return session;
  }

  getEnv(workspaceId: string, sessionId: string): Record<string, string> | undefined {
    const session = this.getSession(workspaceId, sessionId);
    if (!session) return undefined;
    return {
      AGENT_BROWSER_STREAM_PORT: String(session.port),
      AGENT_BROWSER_SESSION: session.agentBrowserSession,
      AGENT_BROWSER_HIVE_WORKSPACE_ID: workspaceId,
      AGENT_BROWSER_HIVE_SESSION_ID: sessionId,
    };
  }

  getVisibleStatuses(workspaceId: string): BrowserStatusPayload[] {
    return Array.from(this.sessions.values())
      .filter((session) => session.workspaceId === workspaceId && session.state !== "registered" && session.state !== "closed")
      .map((session) => this.toPayload(session));
  }

  maybeMarkToolActivity(workspaceId: string, sessionId: string, toolName: string, input: string): BrowserStatusPayload | null {
    const normalizedName = toolName.toLowerCase();
    const commandText = extractCommandText(input);
    const isBrowserTool =
      normalizedName.includes("agent-browser") ||
      normalizedName.includes("agent_browser") ||
      AGENT_BROWSER_COMMAND_PATTERN.test(commandText) ||
      AGENT_BROWSER_ENV_PATTERN.test(commandText);

    if (!isBrowserTool) return null;
    if (AGENT_BROWSER_STOP_PATTERN.test(commandText)) {
      return this.markStreaming(workspaceId, sessionId, false);
    }
    return this.markStreaming(workspaceId, sessionId, true);
  }

  markActive(workspaceId: string, sessionId: string): BrowserStatusPayload | null {
    const session = this.getSession(workspaceId, sessionId);
    if (!session) return null;
    const now = Date.now();
    session.state = "active";
    if (session.streaming === undefined) session.streaming = false;
    session.lastActiveAt = now;
    session.updatedAt = now;
    session.error = undefined;
    const payload = this.toPayload(session);
    this.emit("status", workspaceId, payload);
    return payload;
  }

  markError(workspaceId: string, sessionId: string, error: string): BrowserStatusPayload | null {
    const session = this.getSession(workspaceId, sessionId);
    if (!session) return null;
    session.state = "error";
    session.streaming = false;
    session.error = error;
    session.updatedAt = Date.now();
    const payload = this.toPayload(session);
    this.emit("status", workspaceId, payload);
    return payload;
  }

  ingestStreamMessage(workspaceId: string, sessionId: string, raw: string): void {
    const session = this.getSession(workspaceId, sessionId);
    if (!session) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return;
    }
    if (!isObject(parsed)) return;

    const beforeUrl = session.url;
    const beforeTitle = session.title;
    const beforeStreaming = session.streaming;
    let nextUrl: string | undefined;
    let nextTitle: string | undefined;
    let nextStreaming: boolean | undefined;

    if (parsed.type === "url") {
      nextUrl = extractString(parsed.url) ?? extractString(parsed.value);
      nextTitle = extractString(parsed.title);
    } else if (parsed.type === "tabs") {
      const active = extractActiveTab(parsed.tabs);
      nextUrl = active.url;
      nextTitle = active.title;
    } else if (isObject(parsed.tab)) {
      nextUrl = extractString(parsed.tab.url);
      nextTitle = extractString(parsed.tab.title);
    } else if (parsed.type === "status") {
      const connected = typeof parsed.connected === "boolean" ? parsed.connected : undefined;
      const screencasting = typeof parsed.screencasting === "boolean" ? parsed.screencasting : undefined;
      if (connected === false) {
        nextStreaming = false;
      } else if (connected === true && screencasting === true) {
        nextStreaming = true;
      }
    } else if (parsed.type === "frame") {
      nextStreaming = true;
    }

    if (nextUrl) session.url = nextUrl;
    if (nextTitle) session.title = nextTitle;
    if (nextStreaming !== undefined) session.streaming = nextStreaming;

    if (session.state !== "active") {
      this.markActive(workspaceId, sessionId);
      return;
    }

    if (beforeUrl !== session.url || beforeTitle !== session.title || beforeStreaming !== session.streaming) {
      session.updatedAt = Date.now();
      this.emit("status", workspaceId, this.toPayload(session));
    }
  }

  markStreaming(workspaceId: string, sessionId: string, streaming: boolean): BrowserStatusPayload | null {
    const session = this.getSession(workspaceId, sessionId);
    if (!session) return null;
    const now = Date.now();
    const changed = session.streaming !== streaming || session.state !== "active" || Boolean(session.error);
    session.state = "active";
    session.streaming = streaming;
    session.updatedAt = now;
    if (streaming) {
      session.lastActiveAt = now;
      session.error = undefined;
    }
    if (!changed) return this.toPayload(session);
    const payload = this.toPayload(session);
    this.emit("status", workspaceId, payload);
    return payload;
  }

  closeSession(workspaceId: string, sessionId: string): BrowserStatusPayload | null {
    const session = this.sessions.get(keyFor(workspaceId, sessionId));
    if (!session || session.state === "closed") return null;
    session.state = "closed";
    session.streaming = false;
    session.updatedAt = Date.now();
    const payload = this.toPayload(session);
    this.emit("status", workspaceId, payload);
    this.sessions.delete(keyFor(workspaceId, sessionId));
    return payload;
  }

  closeWorkspace(workspaceId: string): void {
    for (const session of Array.from(this.sessions.values())) {
      if (session.workspaceId === workspaceId) {
        this.closeSession(session.workspaceId, session.sessionId);
      }
    }
  }

  _registerForTests(workspaceId: string, sessionId: string, port: number, state: BrowserSessionState = "registered"): BrowserStatusPayload {
    const now = Date.now();
    const session: BrowserSessionRecord = {
      workspaceId,
      sessionId,
      agentBrowserSession: buildAgentBrowserSession(workspaceId, sessionId),
      port,
      state,
      streaming: false,
      createdAt: now,
      updatedAt: now,
      ...(state === "active" ? { lastActiveAt: now } : {}),
    };
    this.sessions.set(keyFor(workspaceId, sessionId), session);
    return this.toPayload(session);
  }

  _clearForTests(): void {
    this.sessions.clear();
    this.removeAllListeners();
  }

  private toPayload(session: BrowserSessionRecord): BrowserStatusPayload {
    return {
      sessionId: session.sessionId,
      state: session.state,
      streaming: session.streaming,
      streamPath: buildStreamPath(session.workspaceId, session.sessionId),
      updatedAt: session.updatedAt,
      ...(session.lastActiveAt ? { lastActiveAt: session.lastActiveAt } : {}),
      ...(session.url ? { url: session.url } : {}),
      ...(session.title ? { title: session.title } : {}),
      ...(session.error ? { error: session.error } : {}),
    };
  }
}

export const browserSessionManager = new BrowserSessionManager();
