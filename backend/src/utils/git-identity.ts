import { git } from "./git.js";
import { gh } from "./github.js";

/**
 * Neutral default identity for agent commits.
 *
 * Its email doubles as a sentinel: a global identity equal to this is treated
 * as "unclaimed" and may be upgraded to the connected GitHub account later;
 * any other value is the operator's own choice and is never overwritten.
 */
export const HIVE_DEFAULT_GIT_NAME = "Hive Agent";
export const HIVE_DEFAULT_GIT_EMAIL = "hive@orchestrator.local";

/** Cap the `gh api user` lookup so a stalled network or credential prompt cannot hang startup. */
const GH_IDENTITY_TIMEOUT_MS = 5000;

interface GitIdentity {
  name: string;
  email: string;
}

type Runner = (args: string[]) => Promise<{ stdout: string }>;

export interface EnsureGitIdentityDeps {
  runGit?: Runner;
  runGh?: Runner;
}

/** Read a global git config value, treating an unset key (non-zero exit) as empty. */
async function readGlobal(runGit: Runner, key: string): Promise<string> {
  try {
    const { stdout } = await runGit(["config", "--global", key]);
    return stdout.trim();
  } catch {
    return "";
  }
}

/**
 * Identity of the connected GitHub account, or null when `gh` is not signed in.
 *
 * The email is GitHub's noreply form (`<id>+<login>@users.noreply.github.com`)
 * rather than the profile email: it attributes commits correctly, is never
 * null, and can never trip GitHub's "block command line pushes that expose my
 * email" rejection.
 */
async function githubIdentity(runGh: Runner): Promise<GitIdentity | null> {
  try {
    const { stdout } = await runGh(["api", "user"]);
    const data = JSON.parse(stdout) as { id?: number; login?: string; name?: string };
    if (typeof data.id !== "number" || !data.login) return null;
    return {
      name: data.name || data.login,
      email: `${data.id}+${data.login}@users.noreply.github.com`,
    };
  } catch {
    return null;
  }
}

/**
 * Guarantee a global git identity so agent commits never fall back to git's
 * `$USER@$(hostname)` default, which leaks the server's fully-qualified name
 * into every pushed commit.
 *
 * Precedence, highest first:
 *  1. An operator-set global identity (anything other than our own default) is
 *     left untouched.
 *  2. A connected GitHub account supplies name and noreply email.
 *  3. The neutral default, which leaks nothing.
 *
 * Idempotent: writes only the values that differ, so it is safe to call at
 * every startup and after each GitHub sign-in.
 */
export async function ensureGitIdentity(deps: EnsureGitIdentityDeps = {}): Promise<void> {
  const runGit = deps.runGit ?? ((args: string[]) => git(args));
  const runGh = deps.runGh ?? ((args: string[]) => gh(args, { timeoutMs: GH_IDENTITY_TIMEOUT_MS }));

  const currentEmail = await readGlobal(runGit, "user.email");
  // Email is the only field that can leak the hostname (git's `$USER@$(hostname)`
  // default), so once it is anything but our sentinel the operator owns their
  // identity and we leave it — name included.
  if (currentEmail && currentEmail !== HIVE_DEFAULT_GIT_EMAIL) return;

  const currentName = await readGlobal(runGit, "user.name");
  const target = (await githubIdentity(runGh)) ?? {
    name: HIVE_DEFAULT_GIT_NAME,
    email: HIVE_DEFAULT_GIT_EMAIL,
  };

  // Never overwrite a name the operator set themselves; only fill it when it is
  // empty or still our own default.
  const nameClaimed = currentName !== "" && currentName !== HIVE_DEFAULT_GIT_NAME;
  if (!nameClaimed && currentName !== target.name) {
    await runGit(["config", "--global", "user.name", target.name]);
  }
  if (currentEmail !== target.email) {
    await runGit(["config", "--global", "user.email", target.email]);
  }
}
