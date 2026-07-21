import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const CLAUDE_TOKEN_RE = /^sk-ant-oat01-[A-Za-z0-9_-]+$/;
const SECRETS_FILE = "setup-secrets.json";

interface SetupSecrets {
  claudeCodeOAuthToken: string;
}

export type ClaudeTokenWriter = (token: string) => Promise<void>;

export function isValidClaudeToken(token: string): boolean {
  return typeof token === "string" && CLAUDE_TOKEN_RE.test(token);
}

function secretsPath(dataDir: string): string {
  return join(dataDir, SECRETS_FILE);
}

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

export function makeClaudeTokenWriter(dataDir: string): ClaudeTokenWriter {
  return async (token) => {
    if (!isValidClaudeToken(token)) throw new Error("Invalid Claude token format");
    await writeSecretsAtomic(dataDir, { claudeCodeOAuthToken: token });
    process.env.CLAUDE_CODE_OAUTH_TOKEN = token;
  };
}

/**
 * Loads the persisted Claude token into this process. An explicitly configured
 * environment variable always wins over the setup file.
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
    throw new Error(`Invalid JSON in ${SECRETS_FILE}`);
  }
  const token = (parsed as Partial<SetupSecrets> | null)?.claudeCodeOAuthToken;
  if (typeof token !== "string" || !isValidClaudeToken(token)) {
    throw new Error(`Invalid Claude token in ${SECRETS_FILE}`);
  }

  process.env.CLAUDE_CODE_OAUTH_TOKEN = token;
  return true;
}
