import type { FastifyInstance } from "fastify";
import type { CleanupService } from "../services/cleanup-service.js";

interface CleanupRoutesOptions {
  cleanupService?: CleanupService;
}

export async function cleanupRoutes(app: FastifyInstance, opts: CleanupRoutesOptions = {}): Promise<void> {
  app.get("/api/system/disk-usage", async () => {
    if (!opts.cleanupService) return { totalBytes: 0, freeBytes: 0, usedPercent: 0 };
    return opts.cleanupService.getDiskUsage();
  });

  app.post("/api/cleanup/preview", async () => {
    if (!opts.cleanupService) return { reclaimableBytes: 0, artifactDirs: 0, staleArchives: 0, staleRunSessions: 0 };
    return opts.cleanupService.previewCleanup();
  });

  app.post("/api/cleanup/run", async () => {
    if (!opts.cleanupService) return { bytesReclaimed: 0, artifactDirsRemoved: 0, archivesRemoved: 0, runSessionsRemoved: 0 };
    return opts.cleanupService.executeCleanup();
  });
}
