import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { browserSessionManager } from "../services/browser-session-manager.js";
import { isAuthorized, type AuthExpectation } from "../utils/auth.js";
import { buildWorkspaceEnv } from "../utils/env.js";

const PING_INTERVAL_MS = 30_000;
const UPSTREAM_RETRY_INTERVAL_MS = 250;
const UPSTREAM_CONNECT_TIMEOUT_MS = 12_000;
const MIN_VIEWPORT_WIDTH = 160;
const MIN_VIEWPORT_HEIGHT = 120;
const MAX_VIEWPORT_WIDTH = 4096;
const MAX_VIEWPORT_HEIGHT = 4096;
const execFileAsync = promisify(execFile);

export interface BrowserViewportSize {
  width: number;
  height: number;
}

export type BrowserViewportSetter = (
  workspaceId: string,
  sessionId: string,
  viewport: BrowserViewportSize,
) => Promise<void>;

export interface BrowserWsRoutesOptions {
  auth?: AuthExpectation;
  setViewport?: BrowserViewportSetter;
}

function parseViewportDimension(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < min || rounded > max) return null;
  return rounded;
}

function parseViewportResizeMessage(data: WebSocket.RawData, isBinary: boolean): BrowserViewportSize | null {
  if (isBinary) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(data.toString()) as unknown;
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const message = parsed as Record<string, unknown>;
  if (message.type !== "viewport_resize") return null;

  const width = parseViewportDimension(message.width, MIN_VIEWPORT_WIDTH, MAX_VIEWPORT_WIDTH);
  const height = parseViewportDimension(message.height, MIN_VIEWPORT_HEIGHT, MAX_VIEWPORT_HEIGHT);
  if (!width || !height) return null;
  return { width, height };
}

function isRetryableUpstreamMessage(raw: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return false;
  }

  if (typeof parsed !== "object" || parsed === null) return false;
  const message = parsed as Record<string, unknown>;
  if (message.type !== "error" || typeof message.message !== "string") return false;

  const text = message.message.toLowerCase();
  return text.includes("browser not launched") || text.includes("screencast");
}

async function setAgentBrowserViewport(
  workspaceId: string,
  sessionId: string,
  viewport: BrowserViewportSize,
): Promise<void> {
  const env = browserSessionManager.getEnv(workspaceId, sessionId);
  if (!env) throw new Error("Browser session not found");

  await execFileAsync(
    "agent-browser",
    ["set", "viewport", String(viewport.width), String(viewport.height)],
    {
      env: buildWorkspaceEnv(env),
      timeout: 5_000,
      windowsHide: true,
    },
  );
}

export async function browserWsRoutes(
  app: FastifyInstance,
  opts: BrowserWsRoutesOptions = {},
) {
  const { auth } = opts;
  const setViewport = opts.setViewport ?? setAgentBrowserViewport;

  app.get<{
    Params: { wsId: string; sessionId: string };
    Querystring: { token?: string };
  }>(
    "/ws/browser/:wsId/:sessionId",
    { websocket: true },
    async (client, req) => {
      const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
      if (!isAuthorized(req.headers, auth, queryToken)) {
        client.send(JSON.stringify({ type: "error", message: "Unauthorized" }));
        client.close(1008, "Unauthorized");
        return;
      }

      const { wsId, sessionId } = req.params;
      const session = browserSessionManager.getSession(wsId, sessionId);
      if (!session) {
        client.send(JSON.stringify({ type: "error", message: "Browser session not found" }));
        client.close(1008, "Browser session not found");
        return;
      }

      let upstream: WebSocket | null = null;
      let closingFromClient = false;
      let lastViewport: BrowserViewportSize | null = null;
      let upstreamRetryTimer: NodeJS.Timeout | null = null;
      const upstreamConnectDeadline = Date.now() + UPSTREAM_CONNECT_TIMEOUT_MS;

      const closeBoth = (code = 1000, reason?: string) => {
        if (upstreamRetryTimer) {
          clearTimeout(upstreamRetryTimer);
          upstreamRetryTimer = null;
        }
        if (upstream && (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING)) {
          closingFromClient = true;
          upstream.close();
        }
        if (client.readyState === client.OPEN || client.readyState === client.CONNECTING) {
          client.close(code, reason);
        }
      };

      const pingTimer = setInterval(() => {
        if (client.readyState === client.OPEN) client.ping();
        if (upstream?.readyState === WebSocket.OPEN) upstream.ping();
      }, PING_INTERVAL_MS);

      const markUpstreamUnavailable = () => {
        browserSessionManager.markStreaming(wsId, sessionId, false);
        if (client.readyState === client.OPEN) {
          client.send(JSON.stringify({ type: "error", message: "Browser stream is not ready" }));
        }
      };

      const scheduleUpstreamConnect = () => {
        if (closingFromClient || client.readyState !== client.OPEN) return;
        if (upstreamRetryTimer) return;
        if (Date.now() >= upstreamConnectDeadline) {
          markUpstreamUnavailable();
          closeBoth(1000, "Browser stream unavailable");
          return;
        }
        upstreamRetryTimer = setTimeout(() => {
          upstreamRetryTimer = null;
          connectUpstream();
        }, UPSTREAM_RETRY_INTERVAL_MS);
      };

      const connectUpstream = () => {
        if (closingFromClient || client.readyState !== client.OPEN) return;
        if (upstream && (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING)) return;

        let opened = false;
        let retryingUpstream = false;
        const ws = new WebSocket(`ws://127.0.0.1:${session.port}`);
        upstream = ws;

        ws.on("open", () => {
          opened = true;
          browserSessionManager.markActive(wsId, sessionId);
        });

        ws.on("message", (data, isBinary) => {
          if (client.readyState !== client.OPEN) return;
          if (!isBinary) {
            const text = data.toString();
            if (isRetryableUpstreamMessage(text)) {
              retryingUpstream = true;
              ws.close();
              return;
            }
            browserSessionManager.ingestStreamMessage(wsId, sessionId, text);
            client.send(text);
            return;
          }
          client.send(data, { binary: true });
        });

        ws.on("error", () => {
          if (!opened) {
            scheduleUpstreamConnect();
          }
        });

        ws.on("close", () => {
          if (upstream === ws) upstream = null;
          if ((!opened || retryingUpstream) && !closingFromClient) {
            scheduleUpstreamConnect();
            return;
          }
          clearInterval(pingTimer);
          if (!closingFromClient) {
            browserSessionManager.markStreaming(wsId, sessionId, false);
          }
          if (client.readyState === client.OPEN || client.readyState === client.CONNECTING) {
            client.close(1000, "Browser stream closed");
          }
        });
      };

      connectUpstream();

      // The Hive browser panel is intentionally read-only for page input.
      // Only viewport resize messages are handled locally by Hive and are not
      // forwarded to agent-browser's input WebSocket.
      client.on("message", (data, isBinary) => {
        const viewport = parseViewportResizeMessage(data, isBinary);
        if (!viewport) return;
        if (lastViewport?.width === viewport.width && lastViewport.height === viewport.height) return;
        lastViewport = viewport;
        void setViewport(wsId, sessionId, viewport).catch((err: unknown) => {
          app.log.debug({ err, wsId, sessionId, viewport }, "Failed to resize agent browser viewport");
        });
      });

      client.on("close", () => {
        clearInterval(pingTimer);
        if (upstreamRetryTimer) {
          clearTimeout(upstreamRetryTimer);
          upstreamRetryTimer = null;
        }
        if (upstream && (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING)) {
          closingFromClient = true;
          upstream.close();
        }
      });

      client.on("error", () => {
        closeBoth(1011, "Browser client error");
      });
    },
  );
}
