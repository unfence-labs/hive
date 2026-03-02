/** Exact env vars set by pm2 / the Hive backend / Claude Code that should not leak into workspace child processes. */
const STRIPPED_VARS = [
  "NODE_ENV",
  "PORT",
  "DATA_DIR",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "GITHUB_CLIENT_ID",
  "MAX_THINKING_TOKENS",
  "CLAUDECODE",
  "NODE_APP_INSTANCE",
  "GIT_EDITOR",
] as const;

/** Prefixes — any env var starting with these is stripped automatically. */
const STRIPPED_PREFIXES = [
  "HIVE_",
  "PM2_",
  "pm_",
  "axm_",
  "CLAUDE_CODE_",
] as const;

/**
 * Build a clean environment for workspace child processes.
 * Strips backend-specific vars, then merges optional provider overrides.
 */
export const DEBUG_AGENT_LOGS = ["1", "true", "yes", "on"].includes(
  (process.env.HIVE_DEBUG_AGENT_LOGS ?? "").trim().toLowerCase(),
);

export function buildWorkspaceEnv(
  extra?: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if ((STRIPPED_VARS as readonly string[]).includes(key)) continue;
    if (STRIPPED_PREFIXES.some((p) => key.startsWith(p))) continue;
    env[key] = value;
  }
  if (extra) Object.assign(env, extra);
  return env;
}
