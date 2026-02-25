import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "./test-helpers.js";
import { scanCompletions } from "./completion-scanner.js";

const BUILTIN_LABELS = [
  "/help",
  "/clear",
  "/compact",
  "/init",
  "/model",
  "/context",
  "/cost",
  "/status",
  "/permissions",
  "/fast",
];

let tempDir: string;
let homeDir: string;
let workspaceCwd: string;
let originalHome: string | undefined;

async function writeSkill(dir: string, folder: string, content: string) {
  const skillDir = join(dir, folder);
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), content, "utf-8");
}

async function writeAgent(dir: string, filename: string, content: string) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), content, "utf-8");
}

async function writeInstalledPlugins(content: unknown) {
  const pluginsDir = join(homeDir, ".claude", "plugins");
  await mkdir(pluginsDir, { recursive: true });
  await writeFile(
    join(pluginsDir, "installed_plugins.json"),
    JSON.stringify(content),
    "utf-8",
  );
}

beforeEach(async () => {
  tempDir = await createTempDir("hive-completion-scanner-");
  homeDir = join(tempDir, "home");
  workspaceCwd = join(tempDir, "workspace");
  await mkdir(homeDir, { recursive: true });
  await mkdir(workspaceCwd, { recursive: true });

  originalHome = process.env.HOME;
  process.env.HOME = homeDir;
});

afterEach(async () => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  await rm(tempDir, { recursive: true, force: true });
});

describe("scanCompletions", () => {
  it("returns builtin completions when no skill or agent directories exist", async () => {
    const items = await scanCompletions(workspaceCwd);

    expect(items).toHaveLength(BUILTIN_LABELS.length);
    expect(items.map((item) => item.label)).toEqual(BUILTIN_LABELS);
    expect(items.every((item) => item.source === "builtin")).toBe(true);
  });

  it("scans user and project skills with frontmatter fields", async () => {
    const userSkillsDir = join(homeDir, ".claude", "skills");
    const projectSkillsDir = join(workspaceCwd, ".claude", "skills");

    await writeSkill(
      userSkillsDir,
      "deploy",
      `---
name: ship
description: Deploy safely
argument-hint: <target>
---
# Deploy\n`,
    );

    await writeSkill(
      userSkillsDir,
      "hidden",
      `---
name: hidden
user-invocable: false
---
`,
    );

    await writeSkill(
      projectSkillsDir,
      "lint-local",
      `---
description: Run project lint checks
---
`,
    );

    const items = await scanCompletions(workspaceCwd);
    const slashItems = items.filter((item) => item.type === "slash_command");

    expect(slashItems.some((item) => item.name === "hidden")).toBe(false);

    expect(slashItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "ship",
          label: "/ship",
          description: "Deploy safely",
          argumentHint: "<target>",
          source: "user_skill",
        }),
        expect.objectContaining({
          name: "lint-local",
          label: "/lint-local",
          description: "Run project lint checks",
          source: "project_skill",
        }),
      ]),
    );
  });

  it("falls back to folder name when skill frontmatter does not define name", async () => {
    const userSkillsDir = join(homeDir, ".claude", "skills");

    await writeSkill(userSkillsDir, "fallback-name", "No frontmatter");

    const items = await scanCompletions(workspaceCwd);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "fallback-name",
          label: "/fallback-name",
          source: "user_skill",
        }),
      ]),
    );
  });

  it("scans user and project agents and ignores non-markdown files", async () => {
    const userAgentsDir = join(homeDir, ".claude", "agents");
    const projectAgentsDir = join(workspaceCwd, ".claude", "agents");

    await writeAgent(
      userAgentsDir,
      "reviewer.md",
      `---
name: code-reviewer
description: Reviews pull requests
---
`,
    );

    await writeAgent(projectAgentsDir, "triage.md", "# Triage agent");
    await writeAgent(userAgentsDir, "README.txt", "ignored");

    const items = await scanCompletions(workspaceCwd);

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "agent",
          name: "code-reviewer",
          label: "@code-reviewer",
          description: "Reviews pull requests",
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

    expect(items.some((item) => item.name === "README")).toBe(false);
  });

  it("scans plugin commands from installed_plugins.json", async () => {
    await writeInstalledPlugins({
      plugins: [
        {
          name: "quality-kit",
          description: "Quality plugin",
          commands: [
            {
              name: "/review",
              description: "Run review checks",
              "argument-hint": "<scope>",
            },
            {
              name: "lint",
            },
          ],
        },
        {
          name: "dup",
          commands: [{ name: "lint", description: "duplicate command should be ignored" }],
        },
      ],
    });

    const items = await scanCompletions(workspaceCwd);

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "slash_command",
          name: "review",
          label: "/review",
          description: "Run review checks",
          argumentHint: "<scope>",
          source: "plugin",
        }),
        expect.objectContaining({
          type: "slash_command",
          name: "lint",
          label: "/lint",
          description: "Quality plugin",
          source: "plugin",
        }),
      ]),
    );
  });

  it("ignores malformed plugin manifests", async () => {
    const pluginsDir = join(homeDir, ".claude", "plugins");
    await mkdir(pluginsDir, { recursive: true });
    await writeFile(join(pluginsDir, "installed_plugins.json"), "{bad-json", "utf-8");

    const items = await scanCompletions(workspaceCwd);

    expect(items.some((item) => item.source === "plugin")).toBe(false);
  });

  it("returns completions in stable source order", async () => {
    await writeSkill(
      join(homeDir, ".claude", "skills"),
      "u-skill",
      "---\nname: u-skill\n---",
    );
    await writeSkill(
      join(workspaceCwd, ".claude", "skills"),
      "p-skill",
      "---\nname: p-skill\n---",
    );
    await writeAgent(join(homeDir, ".claude", "agents"), "u-agent.md", "# agent");
    await writeAgent(join(workspaceCwd, ".claude", "agents"), "p-agent.md", "# agent");

    const items = await scanCompletions(workspaceCwd);

    const firstBuiltinIdx = items.findIndex((item) => item.source === "builtin");
    const firstUserSkillIdx = items.findIndex((item) => item.source === "user_skill");
    const firstProjectSkillIdx = items.findIndex((item) => item.source === "project_skill");
    const firstUserAgentIdx = items.findIndex((item) => item.source === "user_agent");
    const firstProjectAgentIdx = items.findIndex((item) => item.source === "project_agent");

    expect(firstBuiltinIdx).toBe(0);
    expect(firstUserSkillIdx).toBeGreaterThan(firstBuiltinIdx);
    expect(firstProjectSkillIdx).toBeGreaterThan(firstUserSkillIdx);
    expect(firstUserAgentIdx).toBeGreaterThan(firstProjectSkillIdx);
    expect(firstProjectAgentIdx).toBeGreaterThan(firstUserAgentIdx);
  });

  it("skips unreadable skill entries without failing the scan", async () => {
    const userSkillsDir = join(homeDir, ".claude", "skills");
    await mkdir(join(userSkillsDir, "broken"), { recursive: true });

    await writeSkill(
      userSkillsDir,
      "valid",
      `---
name: stable
---
`,
    );

    const items = await scanCompletions(workspaceCwd);

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "stable",
          label: "/stable",
          source: "user_skill",
        }),
      ]),
    );
  });
});
