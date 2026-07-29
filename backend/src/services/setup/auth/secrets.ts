import { loadConfig, updateConfig } from "../../../state/config.js";
import { CLAUDE_TOKEN_RE } from "./output.js";

/**
 * The Claude credential Hive provisions for itself.
 *
 * `claude setup-token` mints a long-lived token and prints it; unlike an
 * interactive sign-in it persists nothing, so storing it is Hive's job. It
 * lives on the app config — `config.json` is already the owner-only, atomically
 * written credential store — rather than in the CLI's own credential store,
 * because Hive is what has to hand it to every agent run.
 */

/** Anchored: {@link CLAUDE_TOKEN_RE} is a *finder*, this is a validator. */
const CLAUDE_TOKEN_EXACT_RE = new RegExp(`^${CLAUDE_TOKEN_RE.source}$`);

export function isValidClaudeToken(token: unknown): token is string {
  return typeof token === "string" && CLAUDE_TOKEN_EXACT_RE.test(token);
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
    await updateConfig((config) => {
      config.claudeCodeOAuthToken = token;
    }, dataDir);
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
 * exported a token meant that token, and silently preferring a stored one they
 * may have forgotten about would be the harder failure to diagnose.
 *
 * A stored value that is not a valid token must not stop the server from
 * starting. Hive runs sessions for providers that have nothing to do with
 * Claude, and refusing to boot over one bad credential would take all of them
 * down; the panel reports Claude as not signed in and the operator repairs it
 * there. `loadConfig` already degrades an unreadable config file to defaults.
 */
export async function loadSetupSecrets(dataDir: string): Promise<boolean> {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) return false;

  const { claudeCodeOAuthToken: token } = await loadConfig(dataDir);
  if (token === undefined) return false;
  if (!isValidClaudeToken(token)) {
    console.error("[setup] Ignoring stored Claude token: not a valid token");
    return false;
  }

  process.env.CLAUDE_CODE_OAUTH_TOKEN = token;
  return true;
}
