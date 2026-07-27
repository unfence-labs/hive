import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CLAUDE_TOKEN_RE } from "./output.js";

/**
 * The Claude credential Hive provisions for itself.
 *
 * `claude setup-token` mints a long-lived token and prints it; unlike an
 * interactive sign-in it persists nothing, so storing it is Hive's job. It is
 * held in a file Hive owns rather than in the CLI's own credential store,
 * because Hive is what has to hand it to every agent run.
 */
const SECRETS_FILE = "setup-secrets.json";

/** Anchored: {@link CLAUDE_TOKEN_RE} is a *finder*, this is a validator. */
const CLAUDE_TOKEN_EXACT_RE = new RegExp(`^${CLAUDE_TOKEN_RE.source}$`);

interface SetupSecrets {
  claudeCodeOAuthToken: string;
}

export function isValidClaudeToken(token: unknown): token is string {
  return typeof token === "string" && CLAUDE_TOKEN_EXACT_RE.test(token);
}

function secretsPath(dataDir: string): string {
  return join(dataDir, SECRETS_FILE);
}

/**
 * Write the secrets file so it is never observed half-written and never
 * readable by other accounts on the server: create the temporary file with the
 * final mode up front (not chmod-ed afterwards, which would leave a window
 * where it is world-readable), then rename over the target.
 */
async function writeSecretsAtomic(dataDir: string, secrets: SetupSecrets): Promise<void> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const target = secretsPath(dataDir);
  const temporary = join(dataDir, `.${SECRETS_FILE}.${randomUUID()}.tmp`);

  try {
    await writeFile(temporary, JSON.stringify(secrets, null, 2), {
      encoding: "utf-8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, target);
    await chmod(target, 0o600);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export type ClaudeTokenWriter = (token: string) => Promise<void>;

/**
 * Persist a Claude token and make it live for this process.
 *
 * The shape is checked before anything is written: a parse that went wrong
 * produces a plausible-looking string, and a plausible-looking string stored
 * as a credential fails later, somewhere unrelated, as an authentication error
 * nobody traces back to here.
 */
export function makeClaudeTokenWriter(dataDir: string): ClaudeTokenWriter {
  return async (token) => {
    if (!isValidClaudeToken(token)) {
      throw new Error("Not a Claude authentication token");
    }
    await writeSecretsAtomic(dataDir, { claudeCodeOAuthToken: token });
    process.env.CLAUDE_CODE_OAUTH_TOKEN = token;
  };
}

/** The token to hand to Claude CLI runs, or undefined when there is none. */
export function getClaudeOAuthToken(): string | undefined {
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  return token || undefined;
}

/**
 * Load the persisted token into this process at boot.
 *
 * An explicitly configured environment variable always wins: an operator who
 * exported a token meant that token, and silently preferring a file they may
 * have forgotten about would be the harder failure to diagnose.
 *
 * A file that cannot be read as a valid token must not stop the server from
 * starting. Hive runs sessions for providers that have nothing to do with
 * Claude, and refusing to boot over one unreadable credential would take all
 * of them down; the panel reports Claude as not signed in and the operator
 * repairs it there.
 */
export async function loadSetupSecrets(dataDir: string): Promise<boolean> {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) return false;

  let raw: string;
  try {
    raw = await readFile(secretsPath(dataDir), "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(`[setup] Ignoring ${SECRETS_FILE}: invalid JSON`);
    return false;
  }

  const token = (parsed as Partial<SetupSecrets> | null)?.claudeCodeOAuthToken;
  if (!isValidClaudeToken(token)) {
    console.error(`[setup] Ignoring ${SECRETS_FILE}: no valid Claude token`);
    return false;
  }

  process.env.CLAUDE_CODE_OAUTH_TOKEN = token;
  return true;
}
