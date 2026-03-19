import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getDataDir } from "./state.js";

export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  chatId: string;
}

export interface ApnsConfig {
  enabled: boolean;
  teamId: string;
  keyId: string;
  keyContent: string;
  bundleId: string;
  sandbox: boolean;
  deviceTokens: string[];
}

export interface NotificationsConfig {
  telegram: TelegramConfig;
  apns: ApnsConfig;
}

export interface CleanupConfig {
  postRunArtifactStrip: boolean;
  artifactDirs: string[];
  ttl: {
    archivedWorkspaceDays: number;
    runSessionDeleteDays: number;
    keepMinRuns: number;
    sweepIntervalHours: number;
  };
  disk: {
    softThresholdPercent: number;
    hardThresholdPercent: number;
    checkIntervalSeconds: number;
  };
}

export interface AppConfig {
  notifications: NotificationsConfig;
  cleanup: CleanupConfig;
}

const DEFAULT_CLEANUP: CleanupConfig = {
  postRunArtifactStrip: true,
  artifactDirs: ["node_modules", "target", ".next", "dist", "build", "__pycache__", ".gradle", ".cache", ".parcel-cache"],
  ttl: {
    archivedWorkspaceDays: 30,
    runSessionDeleteDays: 30,
    keepMinRuns: 5,
    sweepIntervalHours: 6,
  },
  disk: {
    softThresholdPercent: 80,
    hardThresholdPercent: 90,
    checkIntervalSeconds: 60,
  },
};

const DEFAULT_APNS: ApnsConfig = {
  enabled: false,
  teamId: "",
  keyId: "",
  keyContent: "",
  bundleId: "",
  sandbox: false,
  deviceTokens: [],
};

const DEFAULT_CONFIG: AppConfig = {
  notifications: {
    telegram: { enabled: false, botToken: "", chatId: "" },
    apns: { ...DEFAULT_APNS },
  },
  cleanup: { ...DEFAULT_CLEANUP },
};

function configFilePath(dataDir: string): string {
  return join(dataDir, "config.json");
}

export async function loadConfig(dataDir = getDataDir()): Promise<AppConfig> {
  try {
    const raw = await readFile(configFilePath(dataDir), "utf-8");
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    const apns = parsed.notifications?.apns;
    const cleanup = parsed.cleanup;
    return {
      notifications: {
        telegram: {
          enabled: parsed.notifications?.telegram?.enabled ?? DEFAULT_CONFIG.notifications.telegram.enabled,
          botToken: parsed.notifications?.telegram?.botToken ?? DEFAULT_CONFIG.notifications.telegram.botToken,
          chatId: parsed.notifications?.telegram?.chatId ?? DEFAULT_CONFIG.notifications.telegram.chatId,
        },
        apns: {
          enabled: apns?.enabled ?? DEFAULT_APNS.enabled,
          teamId: apns?.teamId ?? DEFAULT_APNS.teamId,
          keyId: apns?.keyId ?? DEFAULT_APNS.keyId,
          keyContent: apns?.keyContent ?? DEFAULT_APNS.keyContent,
          bundleId: apns?.bundleId ?? DEFAULT_APNS.bundleId,
          sandbox: apns?.sandbox ?? DEFAULT_APNS.sandbox,
          deviceTokens: apns?.deviceTokens ?? DEFAULT_APNS.deviceTokens,
        },
      },
      cleanup: {
        postRunArtifactStrip: cleanup?.postRunArtifactStrip ?? DEFAULT_CLEANUP.postRunArtifactStrip,
        artifactDirs: cleanup?.artifactDirs ?? DEFAULT_CLEANUP.artifactDirs,
        ttl: {
          archivedWorkspaceDays: cleanup?.ttl?.archivedWorkspaceDays ?? DEFAULT_CLEANUP.ttl.archivedWorkspaceDays,
          runSessionDeleteDays: cleanup?.ttl?.runSessionDeleteDays ?? DEFAULT_CLEANUP.ttl.runSessionDeleteDays,
          keepMinRuns: cleanup?.ttl?.keepMinRuns ?? DEFAULT_CLEANUP.ttl.keepMinRuns,
          sweepIntervalHours: cleanup?.ttl?.sweepIntervalHours ?? DEFAULT_CLEANUP.ttl.sweepIntervalHours,
        },
        disk: {
          softThresholdPercent: cleanup?.disk?.softThresholdPercent ?? DEFAULT_CLEANUP.disk.softThresholdPercent,
          hardThresholdPercent: cleanup?.disk?.hardThresholdPercent ?? DEFAULT_CLEANUP.disk.hardThresholdPercent,
          checkIntervalSeconds: cleanup?.disk?.checkIntervalSeconds ?? DEFAULT_CLEANUP.disk.checkIntervalSeconds,
        },
      },
    };
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export async function saveConfig(config: AppConfig, dataDir = getDataDir()): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const target = configFilePath(dataDir);
  const tmp = join(dataDir, `config.${randomUUID()}.tmp`);
  await writeFile(tmp, JSON.stringify(config, null, 2), "utf-8");
  await rename(tmp, target);
}
