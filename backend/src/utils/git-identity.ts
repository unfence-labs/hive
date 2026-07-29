import { git } from "./git.js";
import { gh } from "./github.js";

/**
 * Neutral default identity for agent commits.
 *
 * Its name and email double as sentinels: global fields equal to these values
 * are treated as "unclaimed" and may be upgraded to the connected GitHub
 * account later; any other value is the operator's own choice and is never
 * overwritten.
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
  const currentName = await readGlobal(runGit, "user.name");

  // A field is "claimed" once it holds anything but empty or our own default.
  // We never overwrite a claimed field, and we fill every unclaimed one — so a
  // partial config (name-only or email-only) ends up complete rather than
  // leaving git to invent the missing half from `$USER@$(hostname)`.
  const emailClaimed = currentEmail !== "" && currentEmail !== HIVE_DEFAULT_GIT_EMAIL;
  const nameClaimed = currentName !== "" && currentName !== HIVE_DEFAULT_GIT_NAME;
  if (emailClaimed && nameClaimed) return;

  const target = (await githubIdentity(runGh)) ?? {
    name: HIVE_DEFAULT_GIT_NAME,
    email: HIVE_DEFAULT_GIT_EMAIL,
  };

  if (!nameClaimed && currentName !== target.name) {
    await runGit(["config", "--global", "user.name", target.name]);
  }
  if (!emailClaimed && currentEmail !== target.email) {
    await runGit(["config", "--global", "user.email", target.email]);
  }
}

/**
 * Build `-c user.name=… -c user.email=…` arguments that guarantee a commit
 * identity for a single git command run in `cwd`, without mutating any config.
 *
 * The effective identity already resolved by git (operator global, repo-local,
 * …) is reused when present; only a missing field falls back to the neutral
 * default. This lets Hive's own merge commit succeed even when no identity is
 * configured, while never overriding one the operator set and never leaking the
 * host through git's `$USER@$(hostname)` default.
 */
export async function commitIdentityArgs(
  cwd: string,
  deps: { runGit?: Runner } = {},
): Promise<string[]> {
  const runGit = deps.runGit ?? ((args: string[]) => git(args, cwd));
  const read = async (key: string): Promise<string> => {
    try {
      return (await runGit(["config", key])).stdout.trim();
    } catch {
      return "";
    }
  };
  const name = (await read("user.name")) || HIVE_DEFAULT_GIT_NAME;
  const email = (await read("user.email")) || HIVE_DEFAULT_GIT_EMAIL;
  return ["-c", `user.name=${name}`, "-c", `user.email=${email}`];
}
