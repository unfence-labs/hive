import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { git } from "./git.js";

/**
 * Create a temporary directory for test data.
 */
export async function createTempDir(prefix = "hive-test-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/**
 * Create a local bare repo that can be used as a clone source in tests.
 * Returns the path to the bare repo.
 */
export async function createFixtureRepo(baseDir: string): Promise<string> {
  const workDir = join(baseDir, "fixture-work");
  const bareDir = join(baseDir, "fixture.git");

  // Create a normal repo with a commit
  await git(["init", workDir]);
  await git(["checkout", "-b", "main"], workDir);

  // Configure git user for this repo
  await git(["config", "user.email", "test@hive.dev"], workDir);
  await git(["config", "user.name", "Hive Test"], workDir);

  // Create a file and commit
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(workDir, "README.md"), "# Test Repo\n");
  await git(["add", "."], workDir);
  await git(["commit", "-m", "initial commit"], workDir);

  // Clone as bare
  await git(["clone", "--bare", workDir, bareDir]);

  return bareDir;
}
