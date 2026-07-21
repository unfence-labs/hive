import {
  type InstallerDeps,
  defaultInstallerDeps,
  runHelper,
} from "./installers/command.js";

// Every Claude OAuth setup token is the `sk-ant-oat01-` prefix
// followed only by [A-Za-z0-9_-] — the same charset the capture path yields.
// Enforcing the whole shape here stops a newline (or any control/metacharacter)
// from injecting a second line into the 0600 env file the token is written to.
const CLAUDE_TOKEN_RE = /^sk-ant-oat01-[A-Za-z0-9_-]+$/;

export function isValidClaudeToken(token: string): boolean {
  return typeof token === "string" && CLAUDE_TOKEN_RE.test(token);
}

/**
 * Persist the Claude OAuth token into the service env. On a provisioned
 * server this writes `CLAUDE_CODE_OAUTH_TOKEN=<token>` into
 * `/etc/hive/hive.env` (root-owned, 0600) via the privileged
 * `write-claude-token.sh` helper. In tests and non-provisioned environments the
 * helper directory does not exist, so the default implementation is a
 * graceful no-op that reports `persisted: false`.
 */
export type ClaudeTokenWriter = (token: string) => Promise<{ persisted: boolean }>;

/**
 * Build a Claude token writer over the given installer deps. Exposed so tests
 * can point `helpersDir` at a temp dir standing in for /etc/hive + the helper.
 */
export function makeClaudeTokenWriter(
  depsOverride?: InstallerDeps,
): ClaudeTokenWriter {
  return async (token: string) => {
    const deps = depsOverride ?? defaultInstallerDeps();

    if (!isValidClaudeToken(token)) {
      // Defensive: callers validate first, but never shell an invalid token.
      return { persisted: false };
    }

    if (!(await deps.helpersAvailable())) {
      console.warn(
        "[setup] privileged helpers unavailable (not a provisioned server); " +
          "Claude token not persisted.",
      );
      return { persisted: false };
    }

    // The token is streamed on the helper's stdin (never argv, so it stays out
    // of the process table and sudo/journald logs); the helper atomically writes
    // hive.env with 0600 perms.
    const result = await runHelper(deps, "write-claude-token", [], { stdin: token });
    if (result.exitCode !== 0) {
      console.warn(
        `[setup] write-claude-token helper failed (exit ${result.exitCode}): ` +
          (result.stderr || result.stdout).trim(),
      );
      return { persisted: false };
    }
    // Adopt the token in-process so detection and future agents see it now —
    // the env file feeds future restarts. Restarting the service here instead
    // would kill in-flight requests and any running auth operation.
    process.env.CLAUDE_CODE_OAUTH_TOKEN = token;
    return { persisted: true };
  };
}

/** Default writer: env-file persistence via helper, graceful no-op off-server. */
export const defaultClaudeTokenWriter: ClaudeTokenWriter = makeClaudeTokenWriter();
