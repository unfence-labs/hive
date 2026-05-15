import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { dirname, join } from "node:path";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createTempDir } from "../utils/test-helpers.js";
import { instructionRoutes } from "./agent-instructions.js";
import {
  _clearInstructionsLockForTests,
  type InstructionRoots,
} from "../state/agent-instructions.js";

let tmpDir: string;
let roots: InstructionRoots;
let app: FastifyInstance;

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
  app = Fastify();
  await app.register((instance) => instructionRoutes(instance, { roots }));
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(tmpDir, { recursive: true, force: true });
  _clearInstructionsLockForTests();
});

describe("instruction settings routes", () => {
  it("returns missing global instructions", async () => {
    const res = await app.inject({ method: "GET", url: "/api/settings/instructions" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(
      expect.objectContaining({
        content: "",
        contentProvider: null,
        syncStatus: "missing",
      }),
    );
  });

  it("saves instructions and links Claude to the Codex file", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/instructions",
      payload: { content: "# Global\n" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(
      expect.objectContaining({
        content: "# Global\n",
        contentProvider: "codex",
        syncStatus: "linked",
      }),
    );
    await expect(readFile(roots.codex, "utf-8")).resolves.toBe("# Global\n");
    const claudeStat = await lstat(roots.claude);
    expect(claudeStat.isSymbolicLink()).toBe(true);
  });

  it("syncs Claude-only instructions", async () => {
    await writeInstruction(roots.claude, "# Claude\n");

    const res = await app.inject({ method: "POST", url: "/api/settings/instructions/sync" });

    expect(res.statusCode).toBe(200);
    expect(res.json().syncStatus).toBe("linked");
    await expect(readFile(roots.codex, "utf-8")).resolves.toBe("# Claude\n");
  });

  it("surfaces active AGENTS.override.md in the response", async () => {
    await writeInstruction(roots.codex, "# Codex\n");
    await writeInstruction(roots.codexOverride, "# Override\n");

    const res = await app.inject({ method: "GET", url: "/api/settings/instructions" });

    expect(res.statusCode).toBe(200);
    expect(res.json().override).toEqual(
      expect.objectContaining({
        present: true,
        active: true,
        path: roots.codexOverride,
      }),
    );
  });

  it("deletes instructions without deleting AGENTS.override.md", async () => {
    await writeInstruction(roots.codex, "# Codex\n");
    await writeInstruction(roots.codexOverride, "# Override\n");

    const res = await app.inject({ method: "DELETE", url: "/api/settings/instructions" });

    expect(res.statusCode).toBe(204);
    await expect(lstat(roots.codex)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(roots.codexOverride, "utf-8")).resolves.toBe("# Override\n");
  });

  it("returns 404 when deleting missing instructions", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/settings/instructions" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Instructions not found" });
  });

  it("rejects empty content", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/instructions",
      payload: { content: "" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Content is required" });
  });
});
