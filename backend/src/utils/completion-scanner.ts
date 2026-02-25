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

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" ? (value as UnknownRecord) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeCommandName(name: string): string {
  return name.trim().replace(/^\//, "");
}

async function scanPluginCommands(home: string): Promise<CompletionItem[]> {
  const pluginsFilePath = join(home, ".claude", "plugins", "installed_plugins.json");
  let content: string;
  try {
    content = await readFile(pluginsFilePath, "utf-8");
  } catch {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }

  const parsedRecord = asRecord(parsed);
  const pluginEntries = parsedRecord?.plugins;
  if (!Array.isArray(pluginEntries)) return [];

  const items: CompletionItem[] = [];
  const seenNames = new Set<string>();

  for (const pluginEntry of pluginEntries) {
    const pluginRecord = asRecord(pluginEntry);
    if (!pluginRecord) continue;
    const pluginDescription = asString(pluginRecord.description);
    const commands = pluginRecord.commands;
    if (!Array.isArray(commands)) continue;

    for (const commandEntry of commands) {
      const commandRecord = asRecord(commandEntry);
      if (!commandRecord) continue;
      const rawName = asString(commandRecord.name);
      if (!rawName) continue;
      const name = normalizeCommandName(rawName);
      if (!name || seenNames.has(name)) continue;

      const description = asString(commandRecord.description) ?? pluginDescription;
      const argumentHint = asString(commandRecord["argument-hint"])
        ?? asString(commandRecord.argumentHint);

      items.push({
        type: "slash_command",
        name,
        label: `/${name}`,
        description,
        argumentHint,
        source: "plugin",
      });
      seenNames.add(name);
    }
  }

  return items;
}

export async function scanCompletions(
  workspaceCwd: string,
): Promise<CompletionItem[]> {
  const home = homedir();
  const userSkillsDir = join(home, ".claude", "skills");
  const projectSkillsDir = join(workspaceCwd, ".claude", "skills");
  const userAgentsDir = join(home, ".claude", "agents");
  const projectAgentsDir = join(workspaceCwd, ".claude", "agents");

  const [userSkills, projectSkills, pluginCommands, userAgents, projectAgents] =
    await Promise.all([
      scanSkills(userSkillsDir, "user_skill"),
      scanSkills(projectSkillsDir, "project_skill"),
      scanPluginCommands(home),
      scanAgents(userAgentsDir, "user_agent"),
      scanAgents(projectAgentsDir, "project_agent"),
    ]);

  return [
    ...BUILTIN_COMMANDS,
    ...userSkills,
    ...projectSkills,
    ...pluginCommands,
    ...userAgents,
    ...projectAgents,
  ];
}
