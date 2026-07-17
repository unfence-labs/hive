import { access, constants } from "node:fs/promises";
import { dirname } from "node:path";

/** Prefix every Claude OAuth setup token carries (§3.4 / §6.4). */
const CLAUDE_TOKEN_PREFIX = "sk-ant-oat01-";

/** Path of the service env file the token hash/value is persisted to (§3.3). */
const HIVE_ENV_PATH = "/etc/hive/hive.env";

export function isValidClaudeToken(token: string): boolean {
  return typeof token === "string" && token.startsWith(CLAUDE_TOKEN_PREFIX) && token.length > CLAUDE_TOKEN_PREFIX.length;
}

/**
 * Persist the Claude OAuth token into the service env (§6.4). On a provisioned
 * server this writes `/etc/hive/hive.env` (root-owned, 0600) via a privileged
 * helper. In tests and non-provisioned environments `/etc/hive` is not writable,
 * so the default implementation is a no-op that reports it did not persist.
 */
export type ClaudeTokenWriter = (token: string) => Promise<{ persisted: boolean }>;

async function isDirWritable(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Default writer: only attempts a write when `/etc/hive` is writable, otherwise
 * warns and reports `persisted: false`. The actual privileged write path lands
 * in a later PR via `helpers/*` — this keeps the endpoint testable now.
 */
export const defaultClaudeTokenWriter: ClaudeTokenWriter = async () => {
  if (!(await isDirWritable(dirname(HIVE_ENV_PATH)))) {
    console.warn(
      `[setup] ${dirname(HIVE_ENV_PATH)} is not writable; Claude token not persisted ` +
        "(expected outside a provisioned server).",
    );
    return { persisted: false };
  }
  // Real persistence (helper-backed env write + verify) lands in PR 3.4.
  console.warn("[setup] Claude token persistence via helper not yet implemented; skipping write.");
  return { persisted: false };
};
