import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createFixtureRepo, createTempDir } from "../utils/test-helpers.js";
import { projectRoutes } from "./projects.js";
import { workspaceRoutes } from "./workspaces.js";
import { completionRoutes } from "./completions.js";
import { markProviderAvailable } from "../agents/providers/registry.js";

let tempDir: string;
let homeDir: string;
let dataDir: string;
let fixtureRepoUrl: string;
let app: ReturnType<typeof Fastify>;
let projectId: string;
let wsId: string;
let wsName: string;
let originalHome: string | undefined;

async function writeSkill(baseDir: string, name: string, content: string) {
  const dir = join(baseDir, ".claude", "skills", name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), content, "utf-8");
}

async function writeAgent(baseDir: string, filename: string, content: string) {
  const dir = join(baseDir, ".claude", "agents");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), content, "utf-8");
}

async function writeCodexSkill(baseDir: string, name: string, content: string) {
  const dir = join(baseDir, ".agents", "skills", name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), content, "utf-8");
}

beforeEach(async () => {
  tempDir = await createTempDir("hive-completions-route-");
  homeDir = join(tempDir, "home");
  dataDir = join(tempDir, "data");
  const fixtureDir = join(tempDir, "fixtures");

  await mkdir(homeDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await mkdir(fixtureDir, { recursive: true });

  originalHome = process.env.HOME;
  process.env.HOME = homeDir;
  markProviderAvailable("codex");

  fixtureRepoUrl = await createFixtureRepo(fixtureDir);

  app = Fastify();
  await app.register((instance: FastifyInstance) => projectRoutes(instance, dataDir));
  await app.register((instance: FastifyInstance) => workspaceRoutes(instance, dataDir));
  await app.register((instance: FastifyInstance) => completionRoutes(instance, dataDir));
  await app.ready();

  const projectRes = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: { url: fixtureRepoUrl },
  });

  projectId = projectRes.json().id;

  const wsRes = await app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/workspaces`,
  });

  wsId = wsRes.json().id;
  wsName = wsRes.json().name;
});

afterEach(async () => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }

  await app.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("GET /api/workspaces/:wsId/completions", () => {
  it("returns 404 for unknown workspace", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/workspaces/ws-missing/completions",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Workspace not found" });
  });

  it("returns builtin, user, and project completions", async () => {
    const workspaceDir = join(dataDir, projectId, "workspaces", wsName);

    await writeSkill(
      homeDir,
      "deploy",
      `---
name: deploy
description: Deploy from home skills
---
`,
    );

    await writeSkill(
      workspaceDir,
      "local-lint",
      `---
name: local-lint
description: Lint this workspace
---
`,
    );

    await writeAgent(
      homeDir,
      "reviewer.md",
      `---
name: reviewer
description: Global code reviewer
---
`,
    );

    await writeAgent(workspaceDir, "triage.md", "# triage\n");

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/completions`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);

    expect(body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "slash_command",
          name: "help",
          label: "/help",
          source: "builtin",
        }),
        expect.objectContaining({
          type: "slash_command",
          name: "deploy",
          label: "/deploy",
          source: "user_skill",
        }),
        expect.objectContaining({
          type: "slash_command",
          name: "local-lint",
          label: "/local-lint",
          source: "project_skill",
        }),
        expect.objectContaining({
          type: "agent",
          name: "reviewer",
          label: "@reviewer",
          source: "user_agent",
        }),
        expect.objectContaining({
          type: "agent",
          name: "triage",
          label: "@triage",
          source: "project_agent",
        }),
      ]),
    );
  });

  it("returns provider-specific Codex completions", async () => {
    const workspaceDir = join(dataDir, projectId, "workspaces", wsName);

    await writeCodexSkill(
      workspaceDir,
      "fix-ci",
      `---
name: fix-ci
description: Fix CI failures
---
`,
    );

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/completions?provider=codex`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "slash_command",
          name: "review",
          label: "/review",
          source: "builtin",
        }),
        expect.objectContaining({
          type: "slash_command",
          name: "fix-ci",
          label: "/fix-ci",
          replacementLabel: "$fix-ci",
          source: "project_skill",
        }),
      ]),
    );
  });

  it("includes the Codex /goal completion", async () => {
    markProviderAvailable("codex");

    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/completions?provider=codex`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "slash_command",
          name: "goal",
          label: "/goal",
          source: "builtin",
        }),
      ]),
    );
  });

  it("rejects unsupported completion providers", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${wsId}/completions?provider=unknown`,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Unsupported completion provider" });
  });

  it("reads project skills from the requested workspace path only", async () => {
    const ws2Res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/workspaces`,
    });

    const ws2Id = ws2Res.json().id as string;
    const ws2Name = ws2Res.json().name as string;

    const ws1Path = join(dataDir, projectId, "workspaces", wsName);
    const ws2Path = join(dataDir, projectId, "workspaces", ws2Name);

    await writeSkill(
      ws1Path,
      "ws1-only",
      `---
name: ws1-only
---
`,
    );

    await writeSkill(
      ws2Path,
      "ws2-only",
      `---
name: ws2-only
---
`,
    );

    const ws1Res = await app.inject({ method: "GET", url: `/api/workspaces/${wsId}/completions` });
    const ws2CompletionsRes = await app.inject({
      method: "GET",
      url: `/api/workspaces/${ws2Id}/completions`,
    });

    const ws1Items = ws1Res.json().items as Array<{ name: string; source: string }>;
    const ws2Items = ws2CompletionsRes.json().items as Array<{ name: string; source: string }>;

    expect(ws1Items.some((item) => item.name === "ws1-only" && item.source === "project_skill")).toBe(true);
    expect(ws1Items.some((item) => item.name === "ws2-only")).toBe(false);

    expect(ws2Items.some((item) => item.name === "ws2-only" && item.source === "project_skill")).toBe(true);
    expect(ws2Items.some((item) => item.name === "ws1-only")).toBe(false);
  });
});
