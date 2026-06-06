import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { BrainState } from "../types.js";
import { git } from "../utils/git.js";
import {
  createGitHubRepository,
  deleteGitHubRepository,
  type GitHubRepository,
} from "../utils/github.js";
import { brainDir, brainRepoPath } from "../utils/paths.js";
import { validateRepositoryUrl } from "../utils/repo-url.js";
import { ConflictError } from "../utils/errors.js";
import { getDataDir } from "../state/state.js";
import { deleteBrainState, loadBrainState, saveBrainState } from "../state/brain.js";

type PersistedBrainState = Extract<BrainState, { exists: true }>;

export interface BrainCreateOptions {
  /** Injectable GitHub creation hook for tests and offline fixtures. */
  createRemote?: (name: string) => Promise<GitHubRepository>;
  /** Injectable remote cleanup hook for failed setup. */
  deleteRemote?: (fullName: string) => Promise<void>;
  /** Injectable clock for deterministic state timestamps. */
  now?: () => Date;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

async function assertBrainDoesNotExist(dataDir: string): Promise<void> {
  const state = await loadBrainState(dataDir);
  const repoExists = await pathExists(brainRepoPath(dataDir));
  if (state.exists || repoExists) {
    throw new ConflictError("Brain already exists");
  }
}

function assertPathInsideBrain(dataDir: string, target: string): void {
  const root = resolve(brainDir(dataDir));
  const resolvedTarget = resolve(target);
  if (resolvedTarget !== root && !resolvedTarget.startsWith(`${root}${sep}`)) {
    throw new Error("Refusing to delete a path outside the Brain directory");
  }
}

async function persistBrain(repoUrl: string, dataDir: string, now: () => Date): Promise<PersistedBrainState> {
  const state: PersistedBrainState = {
    exists: true,
    repoUrl,
    createdAt: now().toISOString(),
  };
  await saveBrainState(state, dataDir);
  return state;
}

/** Create the singleton Brain GitHub repository, clone it normally, seed README, commit, and push. */
export async function createBrain(
  name: string,
  dataDir = getDataDir(),
  options: BrainCreateOptions = {},
): Promise<PersistedBrainState> {
  await assertBrainDoesNotExist(dataDir);
  const dir = brainDir(dataDir);
  const repoPath = brainRepoPath(dataDir);
  await mkdir(dir, { recursive: true });

  const createRemote = options.createRemote ?? ((repoName: string) =>
    createGitHubRepository(repoName, "private"));
  const deleteRemote = options.deleteRemote ?? deleteGitHubRepository;
  const remote = await createRemote(name);

  try {
    await git(["clone", remote.sshUrl, repoPath]);
    await git(["checkout", "-b", "main"], repoPath);
    await writeFile(
      join(repoPath, "README.md"),
      `# ${remote.name}\n\nThis repository stores your Hive Brain knowledge base.\n`,
      "utf-8",
    );
    await git(["add", "README.md"], repoPath);
    await git(["commit", "-m", "Initial Brain"], repoPath);
    await git(["push", "-u", "origin", "main"], repoPath);
    return await persistBrain(remote.sshUrl, dataDir, options.now ?? (() => new Date()));
  } catch (err) {
    await rm(repoPath, { recursive: true, force: true }).catch(() => {});
    await deleteRemote(remote.fullName).catch(() => {});
    throw err;
  }
}

/** Connect the singleton Brain to an existing repository by normal-cloning it. */
export async function connectBrain(
  url: string,
  dataDir = getDataDir(),
  options: Pick<BrainCreateOptions, "now"> = {},
): Promise<PersistedBrainState> {
  await assertBrainDoesNotExist(dataDir);
  const validatedUrl = validateRepositoryUrl(url, {
    allowLocalPath: process.env.NODE_ENV === "test",
  });
  await mkdir(brainDir(dataDir), { recursive: true });
  await git(["clone", validatedUrl, brainRepoPath(dataDir)]);
  return persistBrain(validatedUrl, dataDir, options.now ?? (() => new Date()));
}

/** Delete the singleton Brain state and normal clone. The remote GitHub repo is not deleted. */
export async function deleteBrain(dataDir = getDataDir()): Promise<void> {
  const dir = brainDir(dataDir);
  const repoPath = brainRepoPath(dataDir);
  assertPathInsideBrain(dataDir, join(dir, "state.json"));
  assertPathInsideBrain(dataDir, repoPath);
  await deleteBrainState(dataDir);
  await rm(repoPath, { recursive: true, force: true });
}
