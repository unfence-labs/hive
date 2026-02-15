import { homedir } from "node:os";
import { join, basename } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { parseFrontmatter } from "./frontmatter.js";
import type { CompletionItem } from "../types.js";

const BUILTIN_COMMANDS: CompletionItem[] = [
  { type: "slash_command", name: "help", label: "/help", description: "Show available commands", source: "builtin" },
  { type: "slash_command", name: "clear", label: "/clear", description: "Clear conversation history", source: "builtin" },
  { type: "slash_command", name: "compact", label: "/compact", description: "Compact conversation context", source: "builtin" },
  { type: "slash_command", name: "init", label: "/init", description: "Initialize project context", source: "builtin" },
  { type: "slash_command", name: "model", label: "/model", description: "Switch Claude model", source: "builtin" },
  { type: "slash_command", name: "context", label: "/context", description: "Manage context files", source: "builtin" },
  { type: "slash_command", name: "cost", label: "/cost", description: "Show session cost", source: "builtin" },
  { type: "slash_command", name: "status", label: "/status", description: "Show session status", source: "builtin" },
  { type: "slash_command", name: "permissions", label: "/permissions", description: "Manage tool permissions", source: "builtin" },
  { type: "slash_command", name: "fast", label: "/fast", description: "Toggle fast mode", source: "builtin" },
];

async function scanSkills(
  dir: string,
  source: "user_skill" | "project_skill",
): Promise<CompletionItem[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const items: CompletionItem[] = [];

  for (const entry of entries) {
    try {
      const skillPath = join(dir, entry, "SKILL.md");
      const content = await readFile(skillPath, "utf-8");
      const fm = parseFrontmatter(content);

      if (fm["user-invocable"] === false) continue;

      const name = typeof fm.name === "string" ? fm.name : entry;
      const description =
        typeof fm.description === "string" ? fm.description : undefined;
      const argumentHint =
        typeof fm["argument-hint"] === "string"
          ? fm["argument-hint"]
          : undefined;

      items.push({
        type: "slash_command",
        name,
        label: `/${name}`,
        description,
        argumentHint,
        source,
      });
    } catch {
      // Skip unreadable entries
    }
  }

  return items;
}

async function scanAgents(
  dir: string,
  source: "user_agent" | "project_agent",
): Promise<CompletionItem[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const items: CompletionItem[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    try {
      const content = await readFile(join(dir, entry), "utf-8");
      const fm = parseFrontmatter(content);

      const name =
        typeof fm.name === "string" ? fm.name : basename(entry, ".md");
      const description =
        typeof fm.description === "string" ? fm.description : undefined;

      items.push({
        type: "agent",
        name,
        label: `@${name}`,
        description,
        source,
      });
    } catch {
      // Skip unreadable entries
    }
  }

  return items;
}

// TODO: Add plugin command scanning from ~/.claude/plugins/installed_plugins.json

export async function scanCompletions(
  workspaceCwd: string,
): Promise<CompletionItem[]> {
  const home = homedir();
  const userSkillsDir = join(home, ".claude", "skills");
  const projectSkillsDir = join(workspaceCwd, ".claude", "skills");
  const userAgentsDir = join(home, ".claude", "agents");
  const projectAgentsDir = join(workspaceCwd, ".claude", "agents");

  const [userSkills, projectSkills, userAgents, projectAgents] =
    await Promise.all([
      scanSkills(userSkillsDir, "user_skill"),
      scanSkills(projectSkillsDir, "project_skill"),
      scanAgents(userAgentsDir, "user_agent"),
      scanAgents(projectAgentsDir, "project_agent"),
    ]);

  return [
    ...BUILTIN_COMMANDS,
    ...userSkills,
    ...projectSkills,
    ...userAgents,
    ...projectAgents,
  ];
}
