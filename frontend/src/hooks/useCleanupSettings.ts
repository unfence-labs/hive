import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./useApi";

interface DiskUsageStats {
  totalBytes: number;
  freeBytes: number;
  usedPercent: number;
}

interface CleanupPreview {
  reclaimableBytes: number;
  artifactDirs: number;
  staleArchives: number;
  staleRunSessions: number;
}

interface CleanupResult {
  bytesReclaimed: number;
  artifactDirsRemoved: number;
  archivesRemoved: number;
  runSessionsRemoved: number;
}

export function useDiskUsage() {
  return useQuery({
    queryKey: ["disk-usage"],
    queryFn: () => api.get<DiskUsageStats>("/api/system/disk-usage"),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useCleanupPreview() {
  return useMutation({
    mutationFn: () => api.post<CleanupPreview>("/api/cleanup/preview"),
  });
}

export function useRunCleanup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<CleanupResult>("/api/cleanup/run"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["disk-usage"] });
    },
  });
}
