import { describe, expect, it, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { bareRepoPath, workspacesDir, resolveDefaultBranch } from "./paths.js";
import { createTempDir, createFixtureRepo } from "./test-helpers.js";

describe("paths utilities", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("builds expected bare repo path", () => {
    expect(bareRepoPath("/tmp/data", "proj-1")).toBe(join("/tmp/data", "proj-1", "repo.git"));
  });

  it("builds expected workspaces path", () => {
    expect(workspacesDir("/tmp/data", "proj-1")).toBe(join("/tmp/data", "proj-1", "workspaces"));
  });

  it("resolves default branch from bare repo HEAD", async () => {
    tempDir = await createTempDir();
    const bare = await createFixtureRepo(tempDir);

    const branch = await resolveDefaultBranch(bare);

    expect(branch).toBe("main");
  });
});
