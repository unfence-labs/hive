import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "../utils/test-helpers.js";
import {
  _clearSkillsLockForTests,
  listGlobalSkills,
  loadGlobalSkill,
  saveGlobalSkill,
  syncMissingGlobalSkills,
  type SkillRoots,
} from "./skills.js";

let tmpDir: string;
let roots: SkillRoots;

async function writeSkill(root: string, folder: string, content: string): Promise<void> {
  const dir = join(root, folder);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), content, "utf-8");
}

beforeEach(async () => {
  tmpDir = await createTempDir();
  roots = {
    claude: join(tmpDir, ".claude", "skills"),
    codex: join(tmpDir, ".agents", "skills"),
  };
  _clearSkillsLockForTests();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  _clearSkillsLockForTests();
});

describe("global skills state", () => {
  it("lists skills from Claude and Codex roots as one unified collection", async () => {
    await writeSkill(
      roots.claude,
      "reviewer",
      "---\nname: reviewer\ndescription: Review code\n---\n# Reviewer\n",
    );
    await writeSkill(
      roots.codex,
      "tester",
      "---\nname: tester\ndescription: Run tests\n---\n# Tester\n",
    );

    const { skills } = await listGlobalSkills(roots);

    expect(skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "reviewer",
          name: "reviewer",
          syncStatus: "claude_only",
          providers: expect.objectContaining({
            claude: expect.objectContaining({ present: true }),
            codex: expect.objectContaining({ present: false }),
          }),
        }),
        expect.objectContaining({
          id: "tester",
          name: "tester",
          syncStatus: "codex_only",
        }),
      ]),
    );
  });

  it("migrates a Claude-only skill into .agents and replaces Claude with a symlink on save", async () => {
    await writeSkill(roots.claude, "reviewer", "---\nname: reviewer\n---\n# Old\n");
    await mkdir(join(roots.claude, "reviewer", "references"), { recursive: true });
    await writeFile(join(roots.claude, "reviewer", "references", "notes.md"), "notes", "utf-8");

    const saved = await saveGlobalSkill("reviewer", "---\nname: reviewer\n---\n# New\n", roots);

    expect(saved?.syncStatus).toBe("linked");
    await expect(readFile(join(roots.codex, "reviewer", "references", "notes.md"), "utf-8")).resolves.toBe("notes");
    await expect(readFile(join(roots.codex, "reviewer", "SKILL.md"), "utf-8")).resolves.toContain("# New");
    const claudeStat = await lstat(join(roots.claude, "reviewer"));
    expect(claudeStat.isSymbolicLink()).toBe(true);
  });

  it("links a Codex-only skill into Claude on sync missing", async () => {
    await writeSkill(roots.codex, "tester", "---\nname: tester\n---\n# Tester\n");

    const result = await syncMissingGlobalSkills(roots);

    expect(result.syncedCount).toBe(1);
    const detail = await loadGlobalSkill("tester", roots);
    expect(detail?.syncStatus).toBe("linked");
    const claudeStat = await lstat(join(roots.claude, "tester"));
    expect(claudeStat.isSymbolicLink()).toBe(true);
  });

  it("canonicalizes matching duplicate folders on sync missing", async () => {
    const content = "---\nname: tester\n---\n# Tester\n";
    await writeSkill(roots.claude, "tester", content);
    await writeSkill(roots.codex, "tester", content);

    const result = await syncMissingGlobalSkills(roots);

    expect(result.syncedCount).toBe(1);
    const detail = await loadGlobalSkill("tester", roots);
    expect(detail?.syncStatus).toBe("linked");
    const claudeStat = await lstat(join(roots.claude, "tester"));
    expect(claudeStat.isSymbolicLink()).toBe(true);
  });

  it("marks existing provider copies as diverged and prefers Codex content for editing", async () => {
    await writeSkill(roots.claude, "audit", "---\nname: audit\n---\n# Claude\n");
    await writeSkill(roots.codex, "audit", "---\nname: audit\n---\n# Codex\n");

    const detail = await loadGlobalSkill("audit", roots);

    expect(detail?.syncStatus).toBe("diverged");
    expect(detail?.contentProvider).toBe("codex");
    expect(detail?.content).toContain("# Codex");
    expect(detail?.providerContents.claude).toContain("# Claude");
  });
});
