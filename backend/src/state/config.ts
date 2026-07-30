import { readFile, writeFile, rename, mkdir, chmod } from "node:fs/promises";
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

export interface KimiConfig {
  apiKey: string;
}

export interface AppConfig {
  notifications: NotificationsConfig;
  kimi: KimiConfig;
  /** Compound model id ("provider:model") used as the default for new conversations. */
  defaultModelId?: string;
}

const DEFAULT_CONFIG: AppConfig = {
  notifications: {
    telegram: { enabled: false, botToken: "", chatId: "" },
  },
  kimi: { apiKey: "" },
};

// Synchronous consumers (KimiProvider.buildEnv, getModelCatalog) cannot await
// loadConfig, so keep the latest Kimi key in memory. Every loadConfig and
// updateConfig refreshes it; startup warms it via main()'s loadConfig, and the
// settings PUT refreshes it through updateConfig — no restart needed.
let cachedKimiApiKey = "";

export function getKimiApiKey(): string {
  return cachedKimiApiKey;
}

function configFilePath(dataDir: string): string {
  return join(dataDir, "config.json");
}

function withDefaults(parsed: Partial<AppConfig>): AppConfig {
  return {
    notifications: {
      telegram: {
        enabled: parsed.notifications?.telegram?.enabled ?? DEFAULT_CONFIG.notifications.telegram.enabled,
        botToken: parsed.notifications?.telegram?.botToken ?? DEFAULT_CONFIG.notifications.telegram.botToken,
        chatId: parsed.notifications?.telegram?.chatId ?? DEFAULT_CONFIG.notifications.telegram.chatId,
      },
    },
    kimi: {
      apiKey: parsed.kimi?.apiKey ?? DEFAULT_CONFIG.kimi.apiKey,
    },
    defaultModelId: typeof parsed.defaultModelId === "string" && parsed.defaultModelId
      ? parsed.defaultModelId
      : undefined,
  };
}

/** Read and parse config.json. Returns null when the file does not exist
 *  (first run); throws when it exists but cannot be read or parsed. */
async function readConfigFile(dataDir: string): Promise<Partial<AppConfig> | null> {
  let raw: string;
  try {
    raw = await readFile(configFilePath(dataDir), "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${configFilePath(dataDir)} does not contain a JSON object`);
  }
  return parsed as Partial<AppConfig>;
}

export async function loadConfig(dataDir = getDataDir()): Promise<AppConfig> {
  let parsed: Partial<AppConfig> | null;
  try {
    parsed = await readConfigFile(dataDir);
  } catch (err) {
    // Degrade reads to defaults so the server keeps running, but never persist
    // this fallback — updateConfig re-reads strictly before writing.
    console.error("[config] failed to read config.json, using defaults:", err);
    parsed = null;
  }
  const config = parsed ? withDefaults(parsed) : structuredClone(DEFAULT_CONFIG);
  cachedKimiApiKey = config.kimi.apiKey;
  return config;
}

export async function saveConfig(config: AppConfig, dataDir = getDataDir()): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const target = configFilePath(dataDir);
  const tmp = join(dataDir, `config.${randomUUID()}.tmp`);
  // Owner-only permissions: config.json holds credentials. Same pattern as project-env.ts.
  await writeFile(tmp, JSON.stringify(config, null, 2), { encoding: "utf-8", mode: 0o600 });
  await rename(tmp, target);
  await chmod(target, 0o600).catch(() => {});
}

// Serializes read-modify-write cycles so concurrent writers cannot load the
// same snapshot and drop each other's changes. saveConfig alone is atomic per
// write but does not close this window.
let updateQueue: Promise<unknown> = Promise.resolve();

export function updateConfig(
  mutate: (config: AppConfig) => void,
  dataDir = getDataDir(),
): Promise<AppConfig> {
  const task = updateQueue.then(async () => {
    // Strict read: if config.json exists but is unreadable or corrupt, fail the
    // update instead of silently overwriting saved settings with defaults.
    const parsed = await readConfigFile(dataDir);
    const config = parsed ? withDefaults(parsed) : structuredClone(DEFAULT_CONFIG);
    mutate(config);
    await saveConfig(config, dataDir);
    cachedKimiApiKey = config.kimi.apiKey;
    return config;
  });
  updateQueue = task.catch(() => undefined); // keep the chain alive on failure
  return task;
}
