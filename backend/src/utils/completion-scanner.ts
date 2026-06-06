import { homedir } from "node:os";
import { basename, join, relative, sep } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { parseFrontmatter } from "./frontmatter.js";
import { parseSkillManifest } from "./skill-manifest.js";
import { parseCustomAgentManifest } from "./custom-agent-manifest.js";
import type { CompletionItem, CompletionSource } from "../types.js";

export type CompletionProvider = "claude" | "codex";

interface ScanOptions {
  provider?: CompletionProvider;
}

interface FileEntry {
  path: string;
  relativePath: string;
}

const BLOCKED_SLASH_COMMANDS = new Set([
  "clear",
  "exit",
  "login",
  "logout",
  "model",
  "new",
  "permissions",
  "quit",
  "resume",
  "update",
  "upgrade",
]);

const CLAUDE_BUILTIN_COMMANDS: Array<Omit<CompletionItem, "type" | "label" | "source">> = [
  { name: "add-dir", description: "Add a working directory for file access", argumentHint: "<path>" },
  { name: "autofix-pr", description: "Start a web session to fix PR feedback or CI failures", argumentHint: "[prompt]" },
  { name: "help", description: "Show available commands" },
  { name: "compact", description: "Compact conversation context", argumentHint: "[instructions]" },
  { name: "init", description: "Initialize project context" },
  { name: "context", description: "Visualize current context usage", argumentHint: "[all]" },
  { name: "cost", description: "Show session cost" },
  { name: "status", description: "Show session status" },
  { name: "diff", description: "Show code changes" },
  { name: "review", description: "Review a pull request locally", argumentHint: "[PR]" },
  {
    name: "code-review",
    description: "Review the current diff for bugs and cleanups",
    argumentHint: "[low|medium|high|ultra] [--fix] [--comment]",
  },
  { name: "security-review", description: "Run a security review" },
  { name: "plan", description: "Enter plan mode with an optional task", argumentHint: "[description]" },
  { name: "goal", description: "Keep working until a goal condition is met", argumentHint: "[condition|clear]" },
  { name: "batch", description: "Orchestrate large-scale changes across agents", argumentHint: "<instruction>" },
  { name: "btw", description: "Ask a side question without bloating context", argumentHint: "<question>" },
  { name: "background", description: "Detach the session into a background agent", argumentHint: "[prompt]" },
  { name: "branch", description: "Fork the current conversation", argumentHint: "[name]" },
  {
    name: "claude-api",
    description: "Load Claude API migration and reference guidance",
    argumentHint: "[migrate|managed-agents-onboard]",
  },
  { name: "debug", description: "Enable and analyze debug logging", argumentHint: "[description]" },
  { name: "effort", description: "Set the current model effort level", argumentHint: "[level|auto]" },
  { name: "fast", description: "Toggle fast mode", argumentHint: "[on|off]" },
  { name: "fewer-permission-prompts", description: "Suggest allowlist rules from transcripts" },
  { name: "feedback", description: "Submit feedback with session context", argumentHint: "[report]" },
  { name: "loop", description: "Run a prompt repeatedly while the session stays open", argumentHint: "[interval] [prompt]" },
  { name: "memory", description: "Edit memory files" },
  { name: "mcp", description: "Manage MCP server connections" },
  { name: "agents", description: "Manage configured agents" },
  { name: "plugin", description: "Manage Claude Code plugins", argumentHint: "[subcommand]" },
  { name: "recap", description: "Generate a one-line session summary" },
  { name: "reload-plugins", description: "Reload active plugins", argumentHint: "[--force]" },
  { name: "rename", description: "Rename the current session", argumentHint: "[name]" },
  { name: "schedule", description: "Create, update, list, or run routines", argumentHint: "[description]" },
  { name: "simplify", description: "Review recent changes and apply quality fixes", argumentHint: "[target]" },
  { name: "run", description: "Launch and drive your app to see a change working" },
  { name: "verify", description: "Verify a change by building and running your app" },
  { name: "run-skill-generator", description: "Generate a per-project run/verify skill" },
  { name: "deep-research", description: "Fan out web searches into a cited report", argumentHint: "<question>" },
  { name: "skills", description: "Browse available skills" },
  { name: "tasks", description: "Manage background tasks" },
  { name: "team-onboarding", description: "Generate a team onboarding guide" },
  { name: "ultraplan", description: "Draft a plan in an ultraplan session", argumentHint: "<prompt>" },
  { name: "ultrareview", description: "Run a deep multi-agent code review", argumentHint: "[PR]" },
  { name: "usage", description: "Show usage and activity stats" },
  { name: "web-setup", description: "Connect GitHub for Claude Code web sessions" },
  { name: "doctor", description: "Check Claude Code installation health" },
  { name: "bug", description: "Report a bug", argumentHint: "[report]" },
];

const CODEX_BUILTIN_COMMANDS: Array<Omit<CompletionItem, "type" | "label" | "source">> = [
  { name: "help", description: "Show available commands" },
  { name: "compact", description: "Compact conversation context" },
  { name: "init", description: "Create or refresh project instructions" },
  { name: "status", description: "Show session status" },
  { name: "diff", description: "Show code changes" },
  { name: "review", description: "Review the working tree for issues" },
  { name: "debug-config", description: "Print config layer and policy diagnostics" },
  { name: "goal", description: "Set, view, or manage a task goal", argumentHint: "[objective|pause|resume|clear]" },
  { name: "mcp", description: "List configured MCP tools", argumentHint: "[verbose]" },
  { name: "plan", description: "Switch to plan mode with an optional task", argumentHint: "[prompt]" },
  { name: "ps", description: "Show background terminals and recent output" },
];

function isBlockedSlashCommand(name: string): boolean {
  return BLOCKED_SLASH_COMMANDS.has(normalizeCommandName(name));
}

function slashCommand(
  name: string,
  source: CompletionSource,
  fields: Partial<CompletionItem> = {},
): CompletionItem | null {
  const normalized = normalizeCommandName(name);
  if (!normalized || isBlockedSlashCommand(normalized)) return null;
  return {
    type: "slash_command",
    name: normalized,
    label: `/${normalized}`,
    source,
    ...fields,
  };
}

function builtinCommands(
  commands: Array<Omit<CompletionItem, "type" | "label" | "source">>,
): CompletionItem[] {
  return commands.flatMap((command) => {
    const item = slashCommand(command.name, "builtin", {
      description: command.description,
      argumentHint: command.argumentHint,
    });
    return item ? [item] : [];
  });
}

async function walkFiles(dir: string, extension: string, root = dir): Promise<FileEntry[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: FileEntry[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(fullPath, extension, root));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(extension)) continue;
    files.push({ path: fullPath, relativePath: relative(root, fullPath) });
  }
  return files;
}

async function scanSkills(
  dir: string,
  source: "user_skill" | "project_skill" | "admin_skill",
  provider: CompletionProvider,
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
      const manifest = parseSkillManifest(content, entry);

      if (!manifest.userInvocable) continue;

      const item = slashCommand(manifest.name, source, {
        description: manifest.description,
        argumentHint: manifest.argumentHint,
        // Codex mentions skills with `$skill`; Hive keeps skills under `/`.
        replacementLabel: provider === "codex" ? `$${normalizeCommandName(manifest.name)}` : undefined,
      });
      if (item) items.push(item);
    } catch {
      // Skip unreadable entries.
    }
  }

  return items;
}

async function scanMarkdownAgents(
  dir: string,
  source: "user_agent" | "project_agent",
): Promise<CompletionItem[]> {
  const files = await walkFiles(dir, ".md");
  const items: CompletionItem[] = [];

  for (const file of files) {
    try {
      const content = await readFile(file.path, "utf-8");
      const manifest = parseCustomAgentManifest("claude", content, basename(file.relativePath, ".md"));

      items.push({
        type: "agent",
        name: manifest.name,
        label: `@${manifest.name}`,
        replacementLabel: `@agent-${manifest.name}`,
        description: manifest.description,
        source,
      });
    } catch {
      // Skip unreadable entries.
    }
  }

  return items;
}

async function scanTomlAgents(
  dir: string,
  source: "user_agent" | "project_agent",
): Promise<CompletionItem[]> {
  const files = await walkFiles(dir, ".toml");
  const items: CompletionItem[] = [];

  for (const file of files) {
    try {
      const content = await readFile(file.path, "utf-8");
      const manifest = parseCustomAgentManifest("codex", content, basename(file.relativePath, ".toml"));

      items.push({
        type: "agent",
        name: manifest.name,
        label: `@${manifest.name}`,
        description: manifest.description,
        source,
      });
    } catch {
      // Skip unreadable entries.
    }
  }

  return items;
}

async function scanClaudeCommands(
  dir: string,
  source: "user_command" | "project_command",
): Promise<CompletionItem[]> {
  const files = await walkFiles(dir, ".md");
  const items: CompletionItem[] = [];

  for (const file of files) {
    try {
      const content = await readFile(file.path, "utf-8");
      const fm = parseFrontmatter(content);
      const fallbackName = file.relativePath
        .slice(0, -".md".length)
        .split(sep)
        .filter(Boolean)
        .join(":");
      const name = typeof fm.name === "string" ? fm.name : fallbackName;
      const description =
        typeof fm.description === "string" ? fm.description : undefined;
      const argumentHint =
        typeof fm["argument-hint"] === "string"
          ? fm["argument-hint"]
          : undefined;
      const item = slashCommand(name, source, { description, argumentHint });
      if (item) items.push(item);
    } catch {
      // Skip unreadable entries.
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
  return name.trim().replace(/^\//, "").replace(/^\$/, "");
}

async function scanClaudePluginCommands(home: string): Promise<CompletionItem[]> {
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

      const item = slashCommand(name, "plugin", {
        description: asString(commandRecord.description) ?? pluginDescription,
        argumentHint: asString(commandRecord["argument-hint"])
          ?? asString(commandRecord.argumentHint),
      });
      if (!item) continue;

      items.push(item);
      seenNames.add(name);
    }
  }

  return items;
}

async function scanClaudeCompletions(workspaceCwd: string): Promise<CompletionItem[]> {
  const home = homedir();
  const [userCommands, projectCommands, userSkills, projectSkills, pluginCommands, userAgents, projectAgents] =
    await Promise.all([
      scanClaudeCommands(join(home, ".claude", "commands"), "user_command"),
      scanClaudeCommands(join(workspaceCwd, ".claude", "commands"), "project_command"),
      scanSkills(join(home, ".claude", "skills"), "user_skill", "claude"),
      scanSkills(join(workspaceCwd, ".claude", "skills"), "project_skill", "claude"),
      scanClaudePluginCommands(home),
      scanMarkdownAgents(join(home, ".claude", "agents"), "user_agent"),
      scanMarkdownAgents(join(workspaceCwd, ".claude", "agents"), "project_agent"),
    ]);

  return [
    ...builtinCommands(CLAUDE_BUILTIN_COMMANDS),
    ...userCommands,
    ...projectCommands,
    ...userSkills,
    ...projectSkills,
    ...pluginCommands,
    ...userAgents,
    ...projectAgents,
  ];
}

async function scanCodexCompletions(workspaceCwd: string): Promise<CompletionItem[]> {
  const home = homedir();
  const [userSkills, projectSkills, adminSkills, userAgents, projectAgents] =
    await Promise.all([
      scanSkills(join(home, ".agents", "skills"), "user_skill", "codex"),
      scanSkills(join(workspaceCwd, ".agents", "skills"), "project_skill", "codex"),
      scanSkills(join("/etc", "codex", "skills"), "admin_skill", "codex"),
      scanTomlAgents(join(home, ".codex", "agents"), "user_agent"),
      scanTomlAgents(join(workspaceCwd, ".codex", "agents"), "project_agent"),
    ]);

  return [
    ...builtinCommands(CODEX_BUILTIN_COMMANDS),
    ...userSkills,
    ...projectSkills,
    ...adminSkills,
    ...userAgents,
    ...projectAgents,
  ];
}

export async function scanCompletions(
  workspaceCwd: string,
  options: ScanOptions = {},
): Promise<CompletionItem[]> {
  const provider = options.provider ?? "claude";
  return provider === "codex"
    ? scanCodexCompletions(workspaceCwd)
    : scanClaudeCompletions(workspaceCwd);
}

function replaceStandaloneToken(content: string, label: string, replacement: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, "g");
  return content.replace(pattern, `$1${replacement}`);
}

export async function replaceCompletionAliases(
  content: string,
  workspaceCwd: string,
  provider: CompletionProvider,
): Promise<string> {
  if (
    (provider === "codex" && !content.includes("/")) ||
    (provider === "claude" && !content.includes("@"))
  ) {
    return content;
  }

  const items = provider === "codex"
    ? await scanCodexCompletions(workspaceCwd)
    : await scanClaudeCompletions(workspaceCwd);
  let resolved = content;
  for (const item of items) {
    if (!item.replacementLabel) continue;
    resolved = replaceStandaloneToken(resolved, item.label, item.replacementLabel);
  }
  return resolved;
}
