import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "./test-helpers.js";
import { replaceCompletionAliases, scanCompletions } from "./completion-scanner.js";

const BUILTIN_LABELS = [
  "/add-dir",
  "/autofix-pr",
  "/help",
  "/compact",
  "/init",
  "/context",
  "/cost",
  "/status",
  "/diff",
  "/review",
  "/code-review",
  "/security-review",
  "/plan",
  "/goal",
  "/batch",
  "/btw",
  "/background",
  "/branch",
  "/claude-api",
  "/debug",
  "/effort",
  "/fast",
  "/fewer-permission-prompts",
  "/feedback",
  "/loop",
  "/memory",
  "/mcp",
  "/agents",
  "/plugin",
  "/recap",
  "/reload-plugins",
  "/rename",
  "/schedule",
  "/simplify",
  "/run",
  "/verify",
  "/run-skill-generator",
  "/deep-research",
  "/skills",
  "/tasks",
  "/team-onboarding",
  "/ultraplan",
  "/ultrareview",
  "/usage",
  "/web-setup",
  "/doctor",
  "/bug",
];

const CODEX_BUILTIN_LABELS = [
  "/help",
  "/compact",
  "/init",
  "/status",
  "/diff",
  "/review",
  "/debug-config",
  "/goal",
  "/mcp",
  "/plan",
  "/ps",
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

async function writeCommand(dir: string, filename: string, content: string) {
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

  it("does not include blocked slash commands", async () => {
    const items = await scanCompletions(workspaceCwd);
    const labels = items.map((item) => item.label);

    expect(labels).not.toEqual(expect.arrayContaining([
      "/clear",
      "/model",
      "/new",
      "/permissions",
      "/resume",
    ]));
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

  it("scans user and project Claude commands recursively", async () => {
    await writeCommand(
      join(homeDir, ".claude", "commands"),
      "release.md",
      `---
description: Prepare a release
argument-hint: <version>
---
`,
    );
    await writeCommand(
      join(workspaceCwd, ".claude", "commands", "qa"),
      "smoke.md",
      `---
name: smoke
description: Run smoke checks
---
`,
    );
    await writeCommand(
      join(workspaceCwd, ".claude", "commands", "release"),
      "notes.md",
      "# Release notes\n",
    );

    const items = await scanCompletions(workspaceCwd);

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "slash_command",
          name: "release",
          label: "/release",
          description: "Prepare a release",
          argumentHint: "<version>",
          source: "user_command",
        }),
        expect.objectContaining({
          type: "slash_command",
          name: "release:notes",
          label: "/release:notes",
          source: "project_command",
        }),
        expect.objectContaining({
          type: "slash_command",
          name: "smoke",
          label: "/smoke",
          description: "Run smoke checks",
          source: "project_command",
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
    await writeCommand(join(homeDir, ".claude", "commands"), "u-command.md", "# command");
    await writeCommand(join(workspaceCwd, ".claude", "commands"), "p-command.md", "# command");

    const items = await scanCompletions(workspaceCwd);

    const firstBuiltinIdx = items.findIndex((item) => item.source === "builtin");
    const firstUserCommandIdx = items.findIndex((item) => item.source === "user_command");
    const firstProjectCommandIdx = items.findIndex((item) => item.source === "project_command");
    const firstUserSkillIdx = items.findIndex((item) => item.source === "user_skill");
    const firstProjectSkillIdx = items.findIndex((item) => item.source === "project_skill");
    const firstUserAgentIdx = items.findIndex((item) => item.source === "user_agent");
    const firstProjectAgentIdx = items.findIndex((item) => item.source === "project_agent");

    expect(firstBuiltinIdx).toBe(0);
    expect(firstUserCommandIdx).toBeGreaterThan(firstBuiltinIdx);
    expect(firstProjectCommandIdx).toBeGreaterThan(firstUserCommandIdx);
    expect(firstUserSkillIdx).toBeGreaterThan(firstProjectCommandIdx);
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

  it("scans Codex builtins, skills, and agents from Codex paths", async () => {
    await writeSkill(
      join(homeDir, ".agents", "skills"),
      "triage",
      `---
name: triage
description: Triage issues
---
`,
    );
    await writeSkill(
      join(workspaceCwd, ".agents", "skills"),
      "local-fix",
      `---
description: Fix local failures
---
`,
    );
    await writeAgent(
      join(homeDir, ".codex", "agents"),
      "reviewer.toml",
      `name = "reviewer"
description = "Reviews changes"
`,
    );
    await writeAgent(
      join(workspaceCwd, ".codex", "agents"),
      "planner.toml",
      `description = "Plans work"
`,
    );

    const items = await scanCompletions(workspaceCwd, { provider: "codex" });

    expect(items.map((item) => item.label).slice(0, CODEX_BUILTIN_LABELS.length)).toEqual(CODEX_BUILTIN_LABELS);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "slash_command",
          name: "triage",
          label: "/triage",
          replacementLabel: "$triage",
          description: "Triage issues",
          source: "user_skill",
        }),
        expect.objectContaining({
          type: "slash_command",
          name: "local-fix",
          label: "/local-fix",
          replacementLabel: "$local-fix",
          source: "project_skill",
        }),
        expect.objectContaining({
          type: "agent",
          name: "reviewer",
          label: "@reviewer",
          description: "Reviews changes",
          source: "user_agent",
        }),
        expect.objectContaining({
          type: "agent",
          name: "planner",
          label: "@planner",
          description: "Plans work",
          source: "project_agent",
        }),
      ]),
    );
  });

  it("replaces Codex skill slash aliases with native skill mentions", async () => {
    await writeSkill(
      join(workspaceCwd, ".agents", "skills"),
      "local-fix",
      `---
name: local-fix
---
`,
    );

    const result = await replaceCompletionAliases(
      "please /local-fix and keep /review",
      workspaceCwd,
      "codex",
    );

    expect(result).toBe("please $local-fix and keep /review");
  });

  it("replaces Claude agent aliases with native agent mentions", async () => {
    await writeAgent(
      join(homeDir, ".claude", "agents"),
      "reviewer.md",
      `---
name: reviewer
description: Reviews changes
---
`,
    );

    const result = await replaceCompletionAliases(
      "ask @reviewer to inspect this",
      workspaceCwd,
      "claude",
    );

    expect(result).toBe("ask @agent-reviewer to inspect this");
  });
});
