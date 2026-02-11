import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { projectRoutes } from "./api/projects.js";
import { workspaceRoutes } from "./api/workspaces.js";
import { sessionRoutes } from "./api/agents.js";
import { streamRoutes } from "./ws/stream.js";
import { createAuthHook } from "./utils/auth.js";
import { createRateLimitHook } from "./utils/rate-limit.js";
import type { SessionOptions } from "./agents/agent-manager.js";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3000);
const DEFAULT_RATE_LIMIT_MAX = 120;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export async function buildApp() {
  const authToken = process.env.HIVE_AUTH_TOKEN?.trim();
  const rateLimitMax = parsePositiveNumber(process.env.HIVE_RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_MAX);
  const rateLimitWindowMs = parsePositiveNumber(
    process.env.HIVE_RATE_LIMIT_WINDOW_MS,
    DEFAULT_RATE_LIMIT_WINDOW_MS,
  );
  const sessionOptions: SessionOptions = {
    skipPermissions: parseBoolean(process.env.HIVE_CLAUDE_SKIP_PERMISSIONS, true),
  };
  const app = Fastify({ logger: true });
  await app.register(websocket);

  app.addHook("onRequest", createAuthHook(authToken));
  app.addHook(
    "onRequest",
    createRateLimitHook({
      maxRequests: rateLimitMax,
      windowMs: rateLimitWindowMs,
    }),
  );

  app.get("/health", async () => ({ status: "ok" }));

  await app.register((instance: FastifyInstance) => projectRoutes(instance));
  await app.register((instance: FastifyInstance) => workspaceRoutes(instance));
  await app.register((instance: FastifyInstance) =>
    sessionRoutes(instance, {
      sessionOptions,
    }),
  );
  await app.register((instance: FastifyInstance) =>
    streamRoutes(instance, {
      authToken,
      sessionOptions,
    }),
  );

  return app;
}

async function main() {
  const app = await buildApp();
  await app.listen({ host: HOST, port: PORT });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
