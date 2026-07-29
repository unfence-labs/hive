import { describe, it, expect, vi } from "vitest";
import {
  ensureGitIdentity,
  HIVE_DEFAULT_GIT_NAME,
  HIVE_DEFAULT_GIT_EMAIL,
} from "./git-identity.js";

/**
 * Build a fake `runGit` backed by an in-memory map of global config keys.
 *
 * Reads (`config --global <key>`) resolve with the stored value, or REJECT for
 * an unset key — matching real git, which exits non-zero when a config key is
 * absent. Writes (`config --global <key> <value>`) update the map so later
 * reads within the same call reflect the write.
 */
function makeRunGit(initial: Record<string, string> = {}) {
  const config = new Map(Object.entries(initial));
  const runGit = vi.fn(async (args: string[]) => {
    const [cmd, scope, key, value] = args;
    if (cmd !== "config" || scope !== "--global") {
      throw new Error(`unexpected git args: ${args.join(" ")}`);
    }
    if (args.length === 4) {
      config.set(key, value);
      return { stdout: "" };
    }
    if (config.has(key)) {
      return { stdout: config.get(key)! };
    }
    throw new Error(`git config: key ${key} not set`);
  });
  return { runGit, config };
}

/** Fake `runGh` that returns a JSON user payload, or rejects when signed out. */
function makeRunGh(user: unknown | null) {
  return vi.fn(async (args: string[]) => {
    if (args[0] !== "api" || args[1] !== "user") {
      throw new Error(`unexpected gh args: ${args.join(" ")}`);
    }
    if (user === null) throw new Error("not signed in");
    return { stdout: JSON.stringify(user) };
  });
}

/** Write-shaped calls carry 4 args; reads carry 3. */
function writes(runGit: ReturnType<typeof vi.fn>): string[][] {
  return runGit.mock.calls.map((c) => c[0] as string[]).filter((a) => a.length === 4);
}

describe("ensureGitIdentity()", () => {
  it("writes the neutral default when gh is not signed in on a fresh machine", async () => {
    const { runGit } = makeRunGit();
    const runGh = makeRunGh(null);

    await ensureGitIdentity({ runGit, runGh });

    expect(writes(runGit)).toEqual([
      ["config", "--global", "user.name", HIVE_DEFAULT_GIT_NAME],
      ["config", "--global", "user.email", HIVE_DEFAULT_GIT_EMAIL],
    ]);
  });

  it("writes the github identity when gh is signed in on a fresh machine", async () => {
    const { runGit } = makeRunGit();
    const runGh = makeRunGh({ id: 583231, login: "octocat", name: "The Octocat" });

    await ensureGitIdentity({ runGit, runGh });

    expect(writes(runGit)).toEqual([
      ["config", "--global", "user.name", "The Octocat"],
      ["config", "--global", "user.email", "583231+octocat@users.noreply.github.com"],
    ]);
  });

  it("falls back to the login when the github name is empty", async () => {
    const { runGit } = makeRunGit();
    const runGh = makeRunGh({ id: 583231, login: "octocat", name: null });

    await ensureGitIdentity({ runGit, runGh });

    expect(writes(runGit)).toEqual([
      ["config", "--global", "user.name", "octocat"],
      ["config", "--global", "user.email", "583231+octocat@users.noreply.github.com"],
    ]);
  });

  it("never overwrites an operator-set identity", async () => {
    const { runGit } = makeRunGit({
      "user.name": "Real Operator",
      "user.email": "me@real.dev",
    });
    const runGh = makeRunGh({ id: 583231, login: "octocat", name: "The Octocat" });

    await ensureGitIdentity({ runGit, runGh });

    expect(writes(runGit)).toEqual([]);
  });

  it("never overwrites an operator-set name when only the email is missing", async () => {
    const { runGit } = makeRunGit({ "user.name": "Real Operator" });
    const runGh = makeRunGh(null);

    await ensureGitIdentity({ runGit, runGh });

    // The name the operator set is kept; only the missing email is filled.
    expect(writes(runGit)).toEqual([
      ["config", "--global", "user.email", HIVE_DEFAULT_GIT_EMAIL],
    ]);
  });

  it("upgrades the sentinel identity to github once gh is connected", async () => {
    const { runGit } = makeRunGit({
      "user.name": HIVE_DEFAULT_GIT_NAME,
      "user.email": HIVE_DEFAULT_GIT_EMAIL,
    });
    const runGh = makeRunGh({ id: 583231, login: "octocat", name: "The Octocat" });

    await ensureGitIdentity({ runGit, runGh });

    expect(writes(runGit)).toEqual([
      ["config", "--global", "user.name", "The Octocat"],
      ["config", "--global", "user.email", "583231+octocat@users.noreply.github.com"],
    ]);
  });

  it("is idempotent when the resolved target already matches", async () => {
    const { runGit } = makeRunGit({
      "user.name": HIVE_DEFAULT_GIT_NAME,
      "user.email": HIVE_DEFAULT_GIT_EMAIL,
    });
    const runGh = makeRunGh(null);

    await ensureGitIdentity({ runGit, runGh });

    expect(writes(runGit)).toEqual([]);
  });
});
