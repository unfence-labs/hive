import os from "node:os";
import { readFileSync, statfsSync } from "node:fs";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { projectRoutes } from "./api/projects.js";
import { brainRoutes } from "./api/brain.js";
import { projectEnvRoutes } from "./api/project-env.js";
import { workspaceRoutes } from "./api/workspaces.js";
import { completionRoutes } from "./api/completions.js";
import { modelRoutes } from "./api/models.js";
import { sessionRoutes } from "./api/agents.js";
import { streamRoutes } from "./ws/stream.js";
import { createAuthHook } from "./utils/auth.js";
import { createRateLimitHook } from "./utils/rate-limit.js";
import { ensureDataDir, getDataDir, loadAllProjects, saveProject } from "./state/state.js";
import { type SessionOptions, rebuildNotifier, stopAllSessions } from "./agents/agent-manager.js";
import { GitSyncService } from "./services/git-sync.js";
import { settingsRoutes } from "./api/settings.js";
import { agentSettingsRoutes } from "./api/agents-settings.js";
import { providerUsageRoutes } from "./api/provider-usage.js";
import { stopProviderUsagePolling } from "./services/provider-usage.js";
import { accountRoutes } from "./api/account.js";
import { scriptRoutes } from "./api/scripts.js";
import { scriptWsRoutes } from "./ws/script.js";
import { browserWsRoutes } from "./ws/browser.js";
import { automationRoutes } from "./api/automations.js";
import { promptTemplateRoutes } from "./api/prompt-templates.js";
import { agentRoutes } from "./api/agent-definitions.js";
import { basePromptRoutes } from "./api/base-prompt.js";
import { brainPromptRoutes } from "./api/brain-prompt.js";
import { skillRoutes } from "./api/skills.js";
import { instructionRoutes } from "./api/agent-instructions.js";
import { subagentRoutes } from "./api/subagents.js";
import { uiPreferencesRoutes } from "./api/ui-preferences.js";
import { AutomationScheduler } from "./services/automation-scheduler.js";
import { loadConfig } from "./state/config.js";
import { broadcastToWorkspace } from "./ws/stream.js";
import type { StreamRoutesOptions } from "./ws/stream.js";
import { preflight } from "./utils/preflight.js";
import { detectAvailableProviders } from "./agents/providers/registry.js";
import { stopAllScripts } from "./services/script-runner.js";
import { initWorkspaceIndex } from "./state/workspace-index.js";

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

// ── CPU usage sampling ──────────────────────────────────────────────
// Prefer cgroup quota-aware CPU usage (Linux containers) and fall back to host CPU usage.

type CgroupVersion = "v1" | "v2";

interface CgroupReader {
  version: CgroupVersion;
  dir: string;
}

interface CgroupSample {
  usageMicros: number;
  quotaCores: number | null;
}

function readTextFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
}

function parsePositiveFiniteNumber(value: string | null): number | null {
  if (!value) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

function normalizeCgroupRelativePath(path: string): string {
  return path === "/" ? "" : path;
}

function parseSelfCgroupPathV2(): string | null {
  const raw = readTextFile("/proc/self/cgroup");
  if (!raw) return null;
  for (const line of raw.split("\n")) {
    const [hierarchyId, controllers, path] = line.split(":");
    if (!hierarchyId || controllers !== "" || !path) continue;
    return normalizeCgroupRelativePath(path);
  }
  return null;
}

function parseSelfCgroupPathV1(): string | null {
  const raw = readTextFile("/proc/self/cgroup");
  if (!raw) return null;
  for (const line of raw.split("\n")) {
    const [, controllers, path] = line.split(":");
    if (!controllers || !path) continue;
    const set = new Set(controllers.split(","));
    if (set.has("cpu") || set.has("cpuacct")) {
      return normalizeCgroupRelativePath(path);
    }
  }
  return null;
}

function uniqueNonEmpty(paths: Array<string | null | undefined>): string[] {
  return [...new Set(paths.filter((value): value is string => Boolean(value)))];
}

function detectCgroupReader(): CgroupReader | null {
  if (process.platform !== "linux") return null;

  const v2Path = parseSelfCgroupPathV2();
  const v2Candidates = uniqueNonEmpty([v2Path ? `/sys/fs/cgroup${v2Path}` : null, "/sys/fs/cgroup"]);
  for (const dir of v2Candidates) {
    if (readTextFile(`${dir}/cpu.max`) && readTextFile(`${dir}/cpu.stat`)) {
      return { version: "v2", dir };
    }
  }

  const v1Path = parseSelfCgroupPathV1();
  const v1Candidates = uniqueNonEmpty([
    v1Path ? `/sys/fs/cgroup/cpu,cpuacct${v1Path}` : null,
    v1Path ? `/sys/fs/cgroup/cpu${v1Path}` : null,
    "/sys/fs/cgroup/cpu,cpuacct",
    "/sys/fs/cgroup/cpu",
  ]);
  for (const dir of v1Candidates) {
    if (
      readTextFile(`${dir}/cpu.cfs_quota_us`) &&
      readTextFile(`${dir}/cpu.cfs_period_us`) &&
      readTextFile(`${dir}/cpuacct.usage`)
    ) {
      return { version: "v1", dir };
    }
  }

  return null;
}

function readCgroupSample(reader: CgroupReader): CgroupSample | null {
  if (reader.version === "v2") {
    const cpuStat = readTextFile(`${reader.dir}/cpu.stat`);
    const cpuMax = readTextFile(`${reader.dir}/cpu.max`);
    if (!cpuStat || !cpuMax) return null;

    const usageMatch = cpuStat.match(/(?:^|\n)usage_usec\s+(\d+)\b/);
    if (!usageMatch) return null;
    const usageMicros = Number(usageMatch[1]);
    if (!Number.isFinite(usageMicros) || usageMicros < 0) return null;

    const [quotaRaw, periodRaw] = cpuMax.split(/\s+/, 2);
    let quotaCores: number | null = null;
    if (quotaRaw && periodRaw && quotaRaw !== "max") {
      const quota = Number(quotaRaw);
      const period = Number(periodRaw);
      if (Number.isFinite(quota) && Number.isFinite(period) && quota > 0 && period > 0) {
        quotaCores = quota / period;
      }
    }
    return { usageMicros, quotaCores };
  }

  const quota = parsePositiveFiniteNumber(readTextFile(`${reader.dir}/cpu.cfs_quota_us`));
  const period = parsePositiveFiniteNumber(readTextFile(`${reader.dir}/cpu.cfs_period_us`));
  const usageNanos = parsePositiveFiniteNumber(readTextFile(`${reader.dir}/cpuacct.usage`));
  if (usageNanos === null) return null;

  const quotaCores = quota !== null && period !== null ? quota / period : null;
  return { usageMicros: usageNanos / 1_000, quotaCores };
}

function snapshotCpuTimes() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const t = cpu.times;
    idle += t.idle;
    total += t.idle + t.user + t.nice + t.sys + t.irq;
  }
  return { idle, total };
}

let prevCpu = snapshotCpuTimes();
let hostCpuPercentCache = -1; // -1 = no sample yet
const cgroupReader = detectCgroupReader();
let prevCgroupUsageMicros: number | null = null;
let prevCgroupSampleTime = process.hrtime.bigint();
let cgroupCpuPercentCache: number | null = null;

setInterval(() => {
  const curr = snapshotCpuTimes();
  const idleDelta = curr.idle - prevCpu.idle;
  const totalDelta = curr.total - prevCpu.total;
  hostCpuPercentCache = totalDelta > 0 ? Math.round((1 - idleDelta / totalDelta) * 100) : 0;
  prevCpu = curr;

  if (!cgroupReader) return;

  const cgroupSample = readCgroupSample(cgroupReader);
  const now = process.hrtime.bigint();
  if (!cgroupSample) {
    cgroupCpuPercentCache = null;
    prevCgroupUsageMicros = null;
    prevCgroupSampleTime = now;
    return;
  }

  const elapsedMicros = Number(now - prevCgroupSampleTime) / 1_000;
  if (
    prevCgroupUsageMicros !== null &&
    elapsedMicros > 0 &&
    cgroupSample.quotaCores !== null &&
    cgroupSample.quotaCores > 0
  ) {
    const usageDelta = cgroupSample.usageMicros - prevCgroupUsageMicros;
    if (usageDelta >= 0) {
      const rawPercent = (usageDelta / (elapsedMicros * cgroupSample.quotaCores)) * 100;
      cgroupCpuPercentCache = Math.max(0, Math.min(100, Math.round(rawPercent)));
    }
  } else {
    cgroupCpuPercentCache = null;
  }

  prevCgroupUsageMicros = cgroupSample.usageMicros;
  prevCgroupSampleTime = now;
}, 5_000).unref();

function getCpuPercent(): number {
  if (cgroupCpuPercentCache !== null) return cgroupCpuPercentCache;
  if (hostCpuPercentCache >= 0) return hostCpuPercentCache;
  // No delta yet — fall back to load average as rough estimate
  return Math.min(100, Math.round((os.loadavg()[0] / (os.cpus().length || 1)) * 100));
}

// ─────────────────────────────────────────────────────────────────────

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

  app.get("/health", async () => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const disk = statfsSync("/");
    const diskTotal = disk.blocks * disk.bsize;
    const diskFree = disk.bavail * disk.bsize;
    const cpuPercent = getCpuPercent();

    return {
      status: "ok",
      env: process.env.NODE_ENV ?? "development",
      system: {
        cpuPercent,
        memPercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
        diskPercent: Math.round(((diskTotal - diskFree) / diskTotal) * 100),
      },
    };
  });

  await app.register((instance: FastifyInstance) => projectRoutes(instance));
  await app.register((instance: FastifyInstance) => brainRoutes(instance));
  await app.register((instance: FastifyInstance) => projectEnvRoutes(instance));
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
  await app.register((instance: FastifyInstance) => providerUsageRoutes(instance));
  await app.register((instance: FastifyInstance) => accountRoutes(instance));
  await app.register((instance: FastifyInstance) => scriptRoutes(instance));
  await app.register((instance: FastifyInstance) =>
    scriptWsRoutes(instance, { authToken }),
  );
  await app.register((instance: FastifyInstance) =>
    browserWsRoutes(instance, { authToken }),
  );
  await app.register((instance: FastifyInstance) =>
    automationRoutes(instance, { scheduler: opts.scheduler }),
  );
  await app.register((instance: FastifyInstance) => promptTemplateRoutes(instance));
  await app.register((instance: FastifyInstance) => agentRoutes(instance));
  await app.register((instance: FastifyInstance) => basePromptRoutes(instance));
  await app.register((instance: FastifyInstance) => brainPromptRoutes(instance));
  await app.register((instance: FastifyInstance) => skillRoutes(instance));
  await app.register((instance: FastifyInstance) => instructionRoutes(instance));
  await app.register((instance: FastifyInstance) => subagentRoutes(instance));
  await app.register((instance: FastifyInstance) => uiPreferencesRoutes(instance));

  return app;
}

const BRANCH_SYNC_INTERVAL_MS = 10_000;

/** Reset workspaces left in "busy" state from a previous unclean shutdown. */
async function reconcileStaleWorkspaces(dataDir: string): Promise<void> {
  const projects = await loadAllProjects(dataDir);
  let fixed = 0;
  for (const project of projects) {
    let dirty = false;
    for (const ws of project.workspaces) {
      if (ws.status === "busy") {
        ws.status = "idle";
        dirty = true;
        fixed++;
      }
    }
    if (dirty) {
      await saveProject(project, dataDir);
    }
  }
  if (fixed > 0) {
    console.log(`[server] Reconciled ${fixed} stale busy workspace(s) to idle`);
  }
}

async function main() {
  // Safety guard: never start the backend from TypeScript source (dev, run via
  // tsx) against the production data dir. getDataDir() silently falls back to
  // ~/.hive when DATA_DIR is unset, so a bare `npm run dev`, `tsx src/index.ts`,
  // or any agent-launched source run would otherwise mutate prod state (and race
  // the live prod scheduler on shared worktrees). Compiled prod (dist/index.js)
  // ends in .js and is unaffected; tests run with NODE_ENV=test.
  const runningFromSource = import.meta.url.endsWith(".ts");
  if (runningFromSource && !process.env.DATA_DIR && process.env.NODE_ENV !== "test") {
    throw new Error(
      "Refusing to start the dev backend without DATA_DIR set: it would use the " +
        "production data dir (~/.hive). Launch via the hive.json runner, or set " +
        "DATA_DIR explicitly (e.g. DATA_DIR=~/.hive-dev).",
    );
  }

  await preflight();
  await detectAvailableProviders();

  const dataDir = getDataDir();
  await ensureDataDir(dataDir);
  await reconcileStaleWorkspaces(dataDir);
  await initWorkspaceIndex(dataDir);

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
    stopProviderUsagePolling();
  });
  gitSync.start(BRANCH_SYNC_INTERVAL_MS);
  await scheduler.start();

  await app.listen({ host: HOST, port: PORT });

  // Graceful shutdown on SIGTERM/SIGINT
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${signal} received, shutting down...`);

    stopAllScripts();

    // Drain persist queues with timeout
    await Promise.race([
      stopAllSessions(),
      new Promise((r) => setTimeout(r, 5000)),
    ]);

    await app.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
