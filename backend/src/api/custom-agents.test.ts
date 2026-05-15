import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { customAgentRoutes } from "./custom-agents.js";
import { _clearCustomAgentsLockForTests, type CustomAgentRoots } from "../state/custom-agents.js";
import { createTempDir } from "../utils/test-helpers.js";

let tmpDir: string;
let roots: CustomAgentRoots;
let app: FastifyInstance;

async function writeAgent(root: string, fileName: string, content: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, fileName), content, "utf-8");
}

beforeEach(async () => {
  tmpDir = await createTempDir();
  roots = {
    claude: join(tmpDir, ".claude", "agents"),
    codex: join(tmpDir, ".codex", "agents"),
  };
  _clearCustomAgentsLockForTests();
  app = Fastify();
  await app.register((instance) => customAgentRoutes(instance, { roots }));
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(tmpDir, { recursive: true, force: true });
  _clearCustomAgentsLockForTests();
});

describe("custom agent settings routes", () => {
  it("returns global custom agents", async () => {
    await writeAgent(roots.claude, "reviewer.md", "---\nname: reviewer\n---\n# Reviewer\n");

    const res = await app.inject({ method: "GET", url: "/api/settings/custom-agents" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      agents: [
        expect.objectContaining({
          id: "reviewer",
          status: "claude_only",
        }),
      ],
    });
  });

  it("returns detail with provider contents", async () => {
    await writeAgent(
      roots.codex,
      "reviewer.toml",
      "name = \"reviewer\"\ndeveloper_instructions = \"Review changes.\"\n",
    );

    const res = await app.inject({ method: "GET", url: "/api/settings/custom-agents/reviewer" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(
      expect.objectContaining({
        id: "reviewer",
        contents: expect.objectContaining({
          codex: expect.stringContaining("developer_instructions"),
        }),
      }),
    );
  });

  it("creates a Claude custom agent", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/settings/custom-agents",
      payload: {
        provider: "claude",
        content: "---\nname: reviewer\ndescription: Review code\n---\n# Reviewer\n",
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual(expect.objectContaining({ id: "reviewer", status: "claude_only" }));
    await expect(readFile(join(roots.claude, "reviewer.md"), "utf-8")).resolves.toContain("# Reviewer");
  });

  it("rejects invalid providers and invalid content", async () => {
    const badProvider = await app.inject({
      method: "POST",
      url: "/api/settings/custom-agents",
      payload: { provider: "gemini", content: "name = \"x\"" },
    });
    expect(badProvider.statusCode).toBe(400);

    const badContent = await app.inject({
      method: "POST",
      url: "/api/settings/custom-agents",
      payload: { provider: "codex", content: "name = \"reviewer\"\n" },
    });
    expect(badContent.statusCode).toBe(400);
    expect(badContent.json()).toEqual({ error: "developer_instructions is required" });
  });

  it("saves an existing provider copy", async () => {
    await writeAgent(roots.claude, "reviewer.md", "---\nname: reviewer\n---\n# Old\n");

    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/custom-agents/reviewer/providers/claude",
      payload: { content: "---\nname: reviewer\n---\n# New\n" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe("reviewer");
    await expect(readFile(join(roots.claude, "reviewer.md"), "utf-8")).resolves.toContain("# New");
  });

  it("returns 409 when saving would collide with another provider copy", async () => {
    await writeAgent(roots.claude, "reviewer.md", "---\nname: reviewer\n---\n# Reviewer\n");
    await writeAgent(roots.claude, "tester.md", "---\nname: tester\n---\n# Tester\n");

    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/custom-agents/reviewer/providers/claude",
      payload: { content: "---\nname: tester\n---\n# Renamed\n" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "Custom agent already exists" });
  });

  it("deletes a provider copy", async () => {
    await writeAgent(roots.claude, "reviewer.md", "---\nname: reviewer\n---\n# Reviewer\n");

    const res = await app.inject({
      method: "DELETE",
      url: "/api/settings/custom-agents/reviewer/providers/claude",
    });

    expect(res.statusCode).toBe(204);
    await expect(lstat(join(roots.claude, "reviewer.md"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("creates a counterpart", async () => {
    await writeAgent(roots.claude, "reviewer.md", "---\nname: reviewer\n---\n# Reviewer\n");

    const res = await app.inject({
      method: "POST",
      url: "/api/settings/custom-agents/reviewer/providers/codex/counterpart",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("both");
    await expect(readFile(join(roots.codex, "reviewer.toml"), "utf-8")).resolves.toContain("developer_instructions");
  });
});
