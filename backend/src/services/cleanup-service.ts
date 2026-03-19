import { statfsSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadConfig, type CleanupConfig } from "../state/config.js";
import { loadRuns } from "../state/automations.js";
import { getDataDir } from "../state/state.js";

export interface DiskUsageStats {
  totalBytes: number;
  freeBytes: number;
  usedPercent: number;
}

export type DiskPressureLevel = "normal" | "soft" | "hard";

export interface CleanupPreview {
  reclaimableBytes: number;
  artifactDirs: number;
  staleArchives: number;
  staleRunSessions: number;
}

export interface CleanupResult {
  bytesReclaimed: number;
  artifactDirsRemoved: number;
  archivesRemoved: number;
  runSessionsRemoved: number;
}

export class CleanupService {
  private readonly dataDir: string;
  private ttlInterval: ReturnType<typeof setInterval> | null = null;
  private diskInterval: ReturnType<typeof setInterval> | null = null;
  private blocked = false;

  constructor(dataDir: string = getDataDir()) {
    this.dataDir = dataDir;
  }

  async start(): Promise<void> {
    const config = await this.getConfig();

    // TTL sweep interval
    const ttlMs = config.ttl.sweepIntervalHours * 60 * 60 * 1000;
    this.ttlInterval = setInterval(() => {
      void this.runTtlSweep().catch((err) =>
        console.error("[cleanup] TTL sweep error:", err),
      );
    }, ttlMs);

    // Disk pressure check interval
    const diskMs = config.disk.checkIntervalSeconds * 1000;
    this.diskInterval = setInterval(() => {
      void this.checkDiskPressure().catch((err) =>
        console.error("[cleanup] Disk check error:", err),
      );
    }, diskMs);

    // Initial checks
    await this.runTtlSweep().catch((err) =>
      console.error("[cleanup] Initial TTL sweep error:", err),
    );
    await this.checkDiskPressure().catch((err) =>
      console.error("[cleanup] Initial disk check error:", err),
    );
  }

  stop(): void {
    if (this.ttlInterval) {
      clearInterval(this.ttlInterval);
      this.ttlInterval = null;
    }
    if (this.diskInterval) {
      clearInterval(this.diskInterval);
      this.diskInterval = null;
    }
  }

  isBlocked(): boolean {
    return this.blocked;
  }

  async getDiskUsage(): Promise<DiskUsageStats> {
    const stats = statfsSync(this.dataDir);
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bavail * stats.bsize;
    const usedPercent = Math.round(
      ((totalBytes - freeBytes) / totalBytes) * 100,
    );
    return { totalBytes, freeBytes, usedPercent };
  }

  async checkDiskPressure(): Promise<DiskPressureLevel> {
    const config = await this.getConfig();
    const usage = await this.getDiskUsage();

    if (usage.usedPercent >= config.disk.hardThresholdPercent) {
      this.blocked = true;
      console.warn(
        `[cleanup] HARD disk pressure: ${usage.usedPercent}% used — blocking new runs`,
      );
      // Emergency cleanup: strip artifacts from automation workspaces
      await this.stripAllAutomationArtifacts().catch((err) =>
        console.error("[cleanup] Emergency artifact strip failed:", err),
      );
      return "hard";
    }

    if (usage.usedPercent >= config.disk.softThresholdPercent) {
      this.blocked = false;
      console.warn(
        `[cleanup] Soft disk pressure: ${usage.usedPercent}% used`,
      );
      await this.stripAllAutomationArtifacts().catch((err) =>
        console.error("[cleanup] Soft pressure artifact strip failed:", err),
      );
      return "soft";
    }

    this.blocked = false;
    return "normal";
  }

  async stripArtifacts(
    workspacePath: string,
  ): Promise<{ bytesReclaimed: number }> {
    const config = await this.getConfig();
    let bytesReclaimed = 0;

    for (const dirName of config.artifactDirs) {
      const targetPath = join(workspacePath, dirName);
      if (!resolve(targetPath).startsWith(resolve(workspacePath))) continue;
      try {
        const s = await stat(targetPath);
        if (s.isDirectory()) {
          const size = await this.getDirSize(targetPath);
          await rm(targetPath, { recursive: true, force: true });
          bytesReclaimed += size;
        }
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          console.error(`[cleanup] Failed to strip ${targetPath}:`, err);
        }
      }
    }

    if (bytesReclaimed > 0) {
      console.log(
        `[cleanup] Stripped artifacts from ${workspacePath}: ${formatBytes(bytesReclaimed)} reclaimed`,
      );
    }

    return { bytesReclaimed };
  }

  async runTtlSweep(): Promise<void> {
    const config = await this.getConfig();
    const now = Date.now();

    // 1. Clean archived workspaces older than TTL
    const archiveDir = join(this.dataDir, "archive");
    await this.cleanStaleEntries(
      archiveDir,
      config.ttl.archivedWorkspaceDays,
      now,
    );

    // 2. Clean old automation run sessions
    const autoDir = join(this.dataDir, "automations");
    try {
      const autoIds = await readdir(autoDir).catch(() => [] as string[]);
      for (const autoId of autoIds) {
        const runsDir = join(autoDir, autoId, "sessions");
        try {
          const sessions = await readdir(runsDir);
          // Load runs to figure out which sessions to keep
          const runs = await loadRuns(autoId, this.dataDir);

          // Keep at least keepMinRuns sessions
          const recentRunSessionIds = new Set(
            runs.slice(0, config.ttl.keepMinRuns).map((r) => r.sessionId),
          );

          for (const sessionDir of sessions) {
            if (recentRunSessionIds.has(sessionDir)) continue;

            const sessionPath = join(runsDir, sessionDir);
            try {
              const s = await stat(sessionPath);
              const ageDays =
                (now - s.mtimeMs) / (24 * 60 * 60 * 1000);
              if (ageDays > config.ttl.runSessionDeleteDays) {
                await rm(sessionPath, {
                  recursive: true,
                  force: true,
                });
              }
            } catch {
              // Ignore
            }
          }
        } catch {
          // No sessions dir
        }
      }
    } catch {
      // No automations dir
    }
  }

  async previewCleanup(): Promise<CleanupPreview> {
    const config = await this.getConfig();
    const now = Date.now();
    let reclaimableBytes = 0;
    let artifactDirs = 0;
    let staleArchives = 0;
    let staleRunSessions = 0;

    // Count artifact dirs in automation workspaces
    const autoDir = join(this.dataDir, "automations");
    try {
      const autoIds = await readdir(autoDir);
      for (const autoId of autoIds) {
        const wsPath = join(autoDir, autoId, "workspace");
        for (const dirName of config.artifactDirs) {
          try {
            const s = await stat(join(wsPath, dirName));
            if (s.isDirectory()) {
              const size = await this.getDirSize(
                join(wsPath, dirName),
              );
              reclaimableBytes += size;
              artifactDirs++;
            }
          } catch {
            /* not present */
          }
        }
      }
    } catch {
      /* no automations */
    }

    // Count stale archives
    const archiveDir = join(this.dataDir, "archive");
    try {
      const entries = await readdir(archiveDir);
      for (const entry of entries) {
        try {
          const s = await stat(join(archiveDir, entry));
          const ageDays =
            (now - s.mtimeMs) / (24 * 60 * 60 * 1000);
          if (ageDays > config.ttl.archivedWorkspaceDays) {
            const size = await this.getDirSize(
              join(archiveDir, entry),
            );
            reclaimableBytes += size;
            staleArchives++;
          }
        } catch {
          /* skip */
        }
      }
    } catch {
      /* no archive dir */
    }

    // Count stale automation run sessions
    try {
      const autoIds = await readdir(autoDir).catch(() => [] as string[]);
      for (const autoId of autoIds) {
        const runsDir = join(autoDir, autoId, "sessions");
        try {
          const sessions = await readdir(runsDir);
          const runs = await loadRuns(autoId, this.dataDir);
          const recentRunSessionIds = new Set(
            runs.slice(0, config.ttl.keepMinRuns).map((r) => r.sessionId),
          );

          for (const sessionDir of sessions) {
            if (recentRunSessionIds.has(sessionDir)) continue;
            const sessionPath = join(runsDir, sessionDir);
            try {
              const s = await stat(sessionPath);
              const ageDays = (now - s.mtimeMs) / (24 * 60 * 60 * 1000);
              if (ageDays > config.ttl.runSessionDeleteDays) {
                staleRunSessions++;
              }
            } catch { /* skip */ }
          }
        } catch { /* no sessions dir */ }
      }
    } catch { /* no automations dir */ }

    return {
      reclaimableBytes,
      artifactDirs,
      staleArchives,
      staleRunSessions,
    };
  }

  async executeCleanup(): Promise<CleanupResult> {
    let bytesReclaimed = 0;
    let artifactDirsRemoved = 0;

    // Capture counts BEFORE cleanup
    const preview = await this.previewCleanup();
    const archivesRemoved = preview.staleArchives;
    const runSessionsRemoved = preview.staleRunSessions;

    // Strip all automation artifacts
    const artifactResult = await this.stripAllAutomationArtifacts();
    bytesReclaimed += artifactResult.bytesReclaimed;
    artifactDirsRemoved += artifactResult.dirsRemoved;

    // Run TTL sweep
    await this.runTtlSweep();

    return {
      bytesReclaimed,
      artifactDirsRemoved,
      archivesRemoved,
      runSessionsRemoved,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────

  private async getConfig(): Promise<CleanupConfig> {
    const config = await loadConfig(this.dataDir);
    return config.cleanup;
  }

  private async stripAllAutomationArtifacts(): Promise<{
    bytesReclaimed: number;
    dirsRemoved: number;
  }> {
    const autoDir = join(this.dataDir, "automations");
    let totalBytes = 0;
    let totalDirs = 0;
    try {
      const autoIds = await readdir(autoDir);
      for (const autoId of autoIds) {
        const wsPath = join(autoDir, autoId, "workspace");
        try {
          const result = await this.stripArtifacts(wsPath);
          totalBytes += result.bytesReclaimed;
          if (result.bytesReclaimed > 0) totalDirs++;
        } catch {
          /* skip */
        }
      }
    } catch {
      /* no automations */
    }
    return { bytesReclaimed: totalBytes, dirsRemoved: totalDirs };
  }

  private async cleanStaleEntries(
    dir: string,
    maxAgeDays: number,
    nowMs: number,
  ): Promise<void> {
    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        const entryPath = join(dir, entry);
        try {
          const s = await stat(entryPath);
          const ageDays =
            (nowMs - s.mtimeMs) / (24 * 60 * 60 * 1000);
          if (ageDays > maxAgeDays) {
            await rm(entryPath, { recursive: true, force: true });
            console.log(
              `[cleanup] Removed stale entry: ${entryPath}`,
            );
          }
        } catch {
          /* skip */
        }
      }
    } catch {
      /* dir doesn't exist */
    }
  }

  private async getDirSize(dirPath: string): Promise<number> {
    let total = 0;
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = join(dirPath, entry.name);
        if (entry.isDirectory()) {
          total += await this.getDirSize(entryPath);
        } else {
          try {
            const s = await stat(entryPath);
            total += s.size;
          } catch {
            /* skip */
          }
        }
      }
    } catch {
      /* skip */
    }
    return total;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
