import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getDataDir } from "./state.js";

export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  chatId: string;
}

export interface NotificationsConfig {
  telegram: TelegramConfig;
}

export interface AppConfig {
  notifications: NotificationsConfig;
}

const DEFAULT_CONFIG: AppConfig = {
  notifications: {
    telegram: { enabled: false, botToken: "", chatId: "" },
  },
};

function configFilePath(dataDir: string): string {
  return join(dataDir, "config.json");
}

export async function loadConfig(dataDir = getDataDir()): Promise<AppConfig> {
  try {
    const raw = await readFile(configFilePath(dataDir), "utf-8");
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    return {
      notifications: {
        telegram: {
          enabled: parsed.notifications?.telegram?.enabled ?? DEFAULT_CONFIG.notifications.telegram.enabled,
          botToken: parsed.notifications?.telegram?.botToken ?? DEFAULT_CONFIG.notifications.telegram.botToken,
          chatId: parsed.notifications?.telegram?.chatId ?? DEFAULT_CONFIG.notifications.telegram.chatId,
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
