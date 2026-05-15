import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createTempDir } from "../utils/test-helpers.js";
import {
  _clearInstructionsLockForTests,
  deleteGlobalInstructions,
  loadGlobalInstructions,
  saveGlobalInstructions,
  syncGlobalInstructions,
  type InstructionRoots,
} from "./agent-instructions.js";

let tmpDir: string;
let roots: InstructionRoots;

async function writeInstruction(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf-8");
}

beforeEach(async () => {
  tmpDir = await createTempDir();
  roots = {
    claude: join(tmpDir, ".claude", "CLAUDE.md"),
    codex: join(tmpDir, ".codex", "AGENTS.md"),
    codexOverride: join(tmpDir, ".codex", "AGENTS.override.md"),
  };
  _clearInstructionsLockForTests();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  _clearInstructionsLockForTests();
});

describe("global instructions state", () => {
  it("returns a missing singleton when no provider files exist", async () => {
    const detail = await loadGlobalInstructions(roots);

    expect(detail.syncStatus).toBe("missing");
    expect(detail.content).toBe("");
    expect(detail.providers.claude).toEqual(
      expect.objectContaining({ present: false, path: roots.claude }),
    );
    expect(detail.providers.codex).toEqual(
      expect.objectContaining({ present: false, path: roots.codex }),
    );
  });

  it("saves instructions in ~/.codex/AGENTS.md and links Claude to it", async () => {
    const saved = await saveGlobalInstructions("# Global\n", roots);

    expect(saved.syncStatus).toBe("linked");
    await expect(readFile(roots.codex, "utf-8")).resolves.toBe("# Global\n");
    const claudeStat = await lstat(roots.claude);
    expect(claudeStat.isSymbolicLink()).toBe(true);
    await expect(readFile(roots.claude, "utf-8")).resolves.toBe("# Global\n");
  });

  it("migrates Claude-only instructions into Codex on sync", async () => {
    await writeInstruction(roots.claude, "# Claude\n");

    const synced = await syncGlobalInstructions(roots);

    expect(synced.syncStatus).toBe("linked");
    await expect(readFile(roots.codex, "utf-8")).resolves.toBe("# Claude\n");
    const claudeStat = await lstat(roots.claude);
    expect(claudeStat.isSymbolicLink()).toBe(true);
  });

  it("links Codex-only instructions into Claude on sync", async () => {
    await writeInstruction(roots.codex, "# Codex\n");

    const synced = await syncGlobalInstructions(roots);

    expect(synced.syncStatus).toBe("linked");
    const claudeStat = await lstat(roots.claude);
    expect(claudeStat.isSymbolicLink()).toBe(true);
    await expect(readFile(roots.claude, "utf-8")).resolves.toBe("# Codex\n");
  });

  it("canonicalizes matching duplicate provider files on sync", async () => {
    await writeInstruction(roots.claude, "# Shared\n");
    await writeInstruction(roots.codex, "# Shared\n");

    const before = await loadGlobalInstructions(roots);
    expect(before.syncStatus).toBe("synced");

    const synced = await syncGlobalInstructions(roots);

    expect(synced.syncStatus).toBe("linked");
    const claudeStat = await lstat(roots.claude);
    expect(claudeStat.isSymbolicLink()).toBe(true);
  });

  it("marks diverged provider files and prefers Codex content for editing", async () => {
    await writeInstruction(roots.claude, "# Claude\n");
    await writeInstruction(roots.codex, "# Codex\n");

    const detail = await loadGlobalInstructions(roots);

    expect(detail.syncStatus).toBe("diverged");
    expect(detail.contentProvider).toBe("codex");
    expect(detail.content).toBe("# Codex\n");
    expect(detail.providerContents.claude).toBe("# Claude\n");
  });

  it("detects active AGENTS.override.md without changing the canonical content", async () => {
    await writeInstruction(roots.codex, "# Codex\n");
    await writeInstruction(roots.codexOverride, "# Override\n");

    const detail = await loadGlobalInstructions(roots);

    expect(detail.override).toEqual(
      expect.objectContaining({
        present: true,
        active: true,
        path: roots.codexOverride,
      }),
    );

    await saveGlobalInstructions("# Updated\n", roots);

    await expect(readFile(roots.codex, "utf-8")).resolves.toBe("# Updated\n");
    await expect(readFile(roots.codexOverride, "utf-8")).resolves.toBe("# Override\n");
  });

  it("deletes Claude and Codex files without deleting AGENTS.override.md", async () => {
    await saveGlobalInstructions("# Global\n", roots);
    await writeInstruction(roots.codexOverride, "# Override\n");

    await expect(deleteGlobalInstructions(roots)).resolves.toBe(true);

    await expect(lstat(roots.claude)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(roots.codex)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(roots.codexOverride, "utf-8")).resolves.toBe("# Override\n");
  });

  it("rejects empty content", async () => {
    await expect(saveGlobalInstructions("", roots)).rejects.toThrow("Content is required");
  });
});
