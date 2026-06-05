import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "../utils/test-helpers.js";
import { brainRepoPath } from "../utils/paths.js";
import { saveBrainState } from "../state/brain.js";
import { resolveChatCwd } from "./chat-context.js";

let tempDir: string;
let dataDir: string;

beforeEach(async () => {
  tempDir = await createTempDir("hive-chat-context-test-");
  dataDir = join(tempDir, "data");
  await mkdir(dataDir, { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("resolveChatCwd", () => {
  it("returns null for the Brain when no Brain is connected", async () => {
    expect(await resolveChatCwd("brain", dataDir)).toBeNull();
  });

  it("returns the Brain repo path when a Brain is connected", async () => {
    await saveBrainState(
      { exists: true, repoUrl: "git@github.com:test/brain.git", createdAt: "2026-06-05T00:00:00.000Z" },
      dataDir,
    );
    expect(await resolveChatCwd("brain", dataDir)).toBe(brainRepoPath(dataDir));
  });

  it("returns null for an unknown workspace id", async () => {
    expect(await resolveChatCwd("proj-does-not-exist", dataDir)).toBeNull();
  });
});
