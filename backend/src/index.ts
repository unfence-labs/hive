import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { projectRoutes } from "./api/projects.js";
import { workspaceRoutes } from "./api/workspaces.js";
import { completionRoutes } from "./api/completions.js";
import { modelRoutes } from "./api/models.js";
import { sessionRoutes } from "./api/agents.js";
import { streamRoutes } from "./ws/stream.js";
import { createAuthHook } from "./utils/auth.js";
import { createRateLimitHook } from "./utils/rate-limit.js";
import { ensureDataDir, getDataDir } from "./state/state.js";
import { type SessionOptions, rebuildNotifier } from "./agents/agent-manager.js";
import { GitSyncService } from "./services/git-sync.js";
import { settingsRoutes } from "./api/settings.js";
import { agentSettingsRoutes } from "./api/agents-settings.js";
import { accountRoutes } from "./api/account.js";
import { scriptRoutes } from "./api/scripts.js";
import { scriptWsRoutes } from "./ws/script.js";
import { automationRoutes } from "./api/automations.js";
import { promptTemplateRoutes } from "./api/prompt-templates.js";
import { basePromptRoutes } from "./api/base-prompt.js";
import { AutomationScheduler } from "./services/automation-scheduler.js";
import { loadConfig } from "./state/config.js";
import { broadcastToWorkspace } from "./ws/stream.js";
import type { StreamRoutesOptions } from "./ws/stream.js";
import { preflight } from "./utils/preflight.js";
import { detectAvailableProviders } from "./agents/providers/registry.js";

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

interface BuildAppOptions {
  gitSyncSnapshotProvider?: StreamRoutesOptions["gitSyncSnapshotProvider"];
  scheduler?: AutomationScheduler;
}

export async function buildApp(opts: BuildAppOptions = {}) {
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
  await app.register(cors, {
    origin: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
  });
  await app.register(websocket, { options: { maxPayload: 10 * 1024 * 1024 } });

  app.addHook("onRequest", createAuthHook(authToken));
  app.addHook(
    "onRequest",
    createRateLimitHook({
      maxRequests: rateLimitMax,
      windowMs: rateLimitWindowMs,
    }),
  );

  app.get("/health", async () => ({ status: "ok", env: process.env.NODE_ENV ?? "development" }));

  await app.register((instance: FastifyInstance) => projectRoutes(instance));
  await app.register((instance: FastifyInstance) => workspaceRoutes(instance));
  await app.register((instance: FastifyInstance) => completionRoutes(instance));
  await app.register((instance: FastifyInstance) => modelRoutes(instance));
  await app.register((instance: FastifyInstance) =>
    sessionRoutes(instance, {
      sessionOptions,
    }),
  );
  await app.register((instance: FastifyInstance) =>
    streamRoutes(instance, {
      authToken,
      sessionOptions,
      gitSyncSnapshotProvider: opts.gitSyncSnapshotProvider,
    }),
  );
  await app.register((instance: FastifyInstance) => settingsRoutes(instance));
  await app.register((instance: FastifyInstance) => agentSettingsRoutes(instance));
  await app.register((instance: FastifyInstance) => accountRoutes(instance));
  await app.register((instance: FastifyInstance) => scriptRoutes(instance));
  await app.register((instance: FastifyInstance) =>
    scriptWsRoutes(instance, { authToken }),
  );
  await app.register((instance: FastifyInstance) =>
    automationRoutes(instance, { scheduler: opts.scheduler }),
  );
  await app.register((instance: FastifyInstance) => promptTemplateRoutes(instance));
  await app.register((instance: FastifyInstance) => basePromptRoutes(instance));

  return app;
}

const BRANCH_SYNC_INTERVAL_MS = 10_000;

async function main() {
  await preflight();
  await detectAvailableProviders();

  const dataDir = getDataDir();
  await ensureDataDir(dataDir);

  const config = await loadConfig(dataDir);
  rebuildNotifier(config);

  const scheduler = new AutomationScheduler(dataDir);

  const gitSync = new GitSyncService(dataDir);
  gitSync.onBranchChange((wsId, info) => {
    broadcastToWorkspace(wsId, { type: "branch_info", info });
  });
  gitSync.onDiffStatsChange((wsId, stats) => {
    broadcastToWorkspace(wsId, { type: "diff_stats", stats });
  });

  const app = await buildApp({ gitSyncSnapshotProvider: gitSync, scheduler });

  try {
    await gitSync.poll();
  } catch {
    app.log.warn("Initial git sync poll failed");
  }

  app.addHook("onClose", () => {
    gitSync.stop();
    scheduler.stop();
  });
  gitSync.start(BRANCH_SYNC_INTERVAL_MS);
  await scheduler.start();

  await app.listen({ host: HOST, port: PORT });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
