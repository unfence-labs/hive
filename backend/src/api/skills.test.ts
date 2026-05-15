import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "../utils/test-helpers.js";
import { skillRoutes } from "./skills.js";
import { _clearSkillsLockForTests, type SkillRoots } from "../state/skills.js";

let tmpDir: string;
let roots: SkillRoots;
let app: FastifyInstance;

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
  app = Fastify();
  await app.register((instance) => skillRoutes(instance, { roots }));
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(tmpDir, { recursive: true, force: true });
  _clearSkillsLockForTests();
});

describe("skill settings routes", () => {
  it("returns global skills", async () => {
    await writeSkill(roots.claude, "reviewer", "---\nname: reviewer\n---\n# Reviewer\n");

    const res = await app.inject({ method: "GET", url: "/api/settings/skills" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      skills: [
        expect.objectContaining({
          id: "reviewer",
          syncStatus: "claude_only",
        }),
      ],
    });
  });

  it("returns skill detail with provider contents", async () => {
    await writeSkill(roots.codex, "tester", "---\nname: tester\n---\n# Tester\n");

    const res = await app.inject({ method: "GET", url: "/api/settings/skills/tester" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(
      expect.objectContaining({
        id: "tester",
        content: expect.stringContaining("# Tester"),
        contentProvider: "codex",
      }),
    );
  });

  it("saves and canonicalizes a Claude-only skill", async () => {
    await writeSkill(roots.claude, "reviewer", "---\nname: reviewer\n---\n# Old\n");

    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/skills/reviewer",
      payload: { content: "---\nname: reviewer\n---\n# New\n" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().syncStatus).toBe("linked");
    await expect(readFile(join(roots.codex, "reviewer", "SKILL.md"), "utf-8")).resolves.toContain("# New");
  });

  it("syncs missing skills", async () => {
    await writeSkill(roots.claude, "reviewer", "---\nname: reviewer\n---\n# Reviewer\n");
    await writeSkill(roots.codex, "tester", "---\nname: tester\n---\n# Tester\n");

    const res = await app.inject({ method: "POST", url: "/api/settings/skills/sync-missing" });

    expect(res.statusCode).toBe(200);
    expect(res.json().syncedCount).toBe(2);
    expect(res.json().skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "reviewer", syncStatus: "linked" }),
        expect.objectContaining({ id: "tester", syncStatus: "linked" }),
      ]),
    );
  });

  it("rejects empty content", async () => {
    await writeSkill(roots.codex, "tester", "---\nname: tester\n---\n# Tester\n");

    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/skills/tester",
      payload: { content: "" },
    });

    expect(res.statusCode).toBe(400);
  });
});
