import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { browserSessionManager } from "../services/browser-session-manager.js";
import { isAuthorized } from "../utils/auth.js";
import { buildWorkspaceEnv } from "../utils/env.js";

const PING_INTERVAL_MS = 30_000;
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
  authToken?: string;
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
  const { authToken } = opts;
  const setViewport = opts.setViewport ?? setAgentBrowserViewport;

  app.get<{
    Params: { wsId: string; sessionId: string };
    Querystring: { token?: string };
  }>(
    "/ws/browser/:wsId/:sessionId",
    { websocket: true },
    async (client, req) => {
      const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
      if (!isAuthorized(req.headers, authToken, queryToken)) {
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

      const upstream = new WebSocket(`ws://127.0.0.1:${session.port}`);
      let upstreamOpen = false;
      let lastViewport: BrowserViewportSize | null = null;

      const closeBoth = (code = 1000, reason?: string) => {
        if (upstream.readyState === upstream.OPEN || upstream.readyState === upstream.CONNECTING) {
          upstream.close();
        }
        if (client.readyState === client.OPEN || client.readyState === client.CONNECTING) {
          client.close(code, reason);
        }
      };

      const pingTimer = setInterval(() => {
        if (client.readyState === client.OPEN) client.ping();
        if (upstream.readyState === upstream.OPEN) upstream.ping();
      }, PING_INTERVAL_MS);

      upstream.on("open", () => {
        upstreamOpen = true;
        browserSessionManager.markActive(wsId, sessionId);
      });

      upstream.on("message", (data, isBinary) => {
        if (client.readyState !== client.OPEN) return;
        if (!isBinary) {
          const text = data.toString();
          browserSessionManager.ingestStreamMessage(wsId, sessionId, text);
          client.send(text);
          return;
        }
        client.send(data, { binary: true });
      });

      upstream.on("error", () => {
        if (!upstreamOpen) {
          browserSessionManager.markError(wsId, sessionId, "Browser stream is not ready");
          if (client.readyState === client.OPEN) {
            client.send(JSON.stringify({ type: "error", message: "Browser stream is not ready" }));
          }
        }
      });

      upstream.on("close", () => {
        clearInterval(pingTimer);
        if (client.readyState === client.OPEN || client.readyState === client.CONNECTING) {
          client.close(1000, "Browser stream closed");
        }
      });

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
        if (upstream.readyState === upstream.OPEN || upstream.readyState === upstream.CONNECTING) {
          upstream.close();
        }
      });

      client.on("error", () => {
        closeBoth(1011, "Browser client error");
      });
    },
  );
}
