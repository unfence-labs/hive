import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { browserSessionManager } from "../services/browser-session-manager.js";
import { isAuthorized } from "../utils/auth.js";

const PING_INTERVAL_MS = 30_000;

export interface BrowserWsRoutesOptions {
  authToken?: string;
}

export async function browserWsRoutes(
  app: FastifyInstance,
  opts: BrowserWsRoutesOptions = {},
) {
  const { authToken } = opts;

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

      // The Hive browser panel is intentionally read-only. Client messages are
      // ignored so keyboard/mouse input cannot reach the agent-owned browser.
      client.on("message", () => {});

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
