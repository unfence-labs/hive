import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "./test-helpers.js";
import { git } from "./git.js";
import { getUntrackedDiff } from "./git-diff.js";

let tempDir: string;
let repoPath: string;

beforeEach(async () => {
  tempDir = await createTempDir("hive-git-diff-test-");
  repoPath = join(tempDir, "repo");
  await mkdir(repoPath, { recursive: true });
  await git(["init", repoPath]);
  await git(["config", "user.email", "test@hive.dev"], repoPath);
  await git(["config", "user.name", "Hive Test"], repoPath);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("getUntrackedDiff", () => {
  it("renders untracked files as new-file patches and counts them", async () => {
    await writeFile(join(repoPath, "a.md"), "hello a\n");
    await writeFile(join(repoPath, "b.md"), "hello b\n");

    const result = await getUntrackedDiff(repoPath);
    expect(result.total).toBe(2);
    expect(result.included).toBe(2);
    expect(result.patch).toContain("b/a.md");
    expect(result.patch).toContain("+hello a");
    expect(result.patch).toContain("b/b.md");
  });

  it("caps rendering and reports the omission via total vs included", async () => {
    for (let i = 0; i < 5; i++) {
      await writeFile(join(repoPath, `n-${i}.md`), `n ${i}\n`);
    }

    const result = await getUntrackedDiff(repoPath, 2);
    expect(result.total).toBe(5);
    expect(result.included).toBe(2);
    // The overflow is recoverable as total - included = 3 omitted files.
    expect(result.total - result.included).toBe(3);
  });

  it("emits an empty-file hunk with no spurious blank addition line", async () => {
    await writeFile(join(repoPath, "empty.md"), "");

    const result = await getUntrackedDiff(repoPath);
    expect(result.included).toBe(1);
    expect(result.patch).toContain("b/empty.md");
    expect(result.patch).toContain("@@ -0,0 +0,0 @@");
    expect(result.patch).not.toContain("+\n");
  });

  it("returns an empty result for a clean tree", async () => {
    expect(await getUntrackedDiff(repoPath)).toEqual({ patch: "", total: 0, included: 0 });
  });
});
