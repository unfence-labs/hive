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

export interface AppConfig {
  notifications: NotificationsConfig;
  /** Compound model id ("provider:model") used as the default for new conversations. */
  defaultModelId?: string;
}

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
};

function configFilePath(dataDir: string): string {
  return join(dataDir, "config.json");
}

export async function loadConfig(dataDir = getDataDir()): Promise<AppConfig> {
  try {
    const raw = await readFile(configFilePath(dataDir), "utf-8");
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    const apns = parsed.notifications?.apns;
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
      defaultModelId: typeof parsed.defaultModelId === "string" && parsed.defaultModelId
        ? parsed.defaultModelId
        : undefined,
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

// Serializes read-modify-write cycles so concurrent writers (settings routes,
// APNs token persistence) cannot load the same snapshot and drop each other's
// changes. saveConfig alone is atomic per write but does not close this window.
let updateQueue: Promise<unknown> = Promise.resolve();

export function updateConfig(
  mutate: (config: AppConfig) => void,
  dataDir = getDataDir(),
): Promise<AppConfig> {
  const task = updateQueue.then(async () => {
    const config = await loadConfig(dataDir);
    mutate(config);
    await saveConfig(config, dataDir);
    return config;
  });
  updateQueue = task.catch(() => undefined); // keep the chain alive on failure
  return task;
}
