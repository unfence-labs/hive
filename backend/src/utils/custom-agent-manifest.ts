import { parse as parseToml, stringify as stringifyToml, type TomlTableWithoutBigInt } from "smol-toml";
import { normalizeConfigName, safeConfigFileStem } from "./config-names.js";
import { parseFrontmatter, stripFrontmatter } from "./frontmatter.js";
import type { CustomAgentProviderId } from "../types.js";

export interface CustomAgentManifest {
  name: string;
  description?: string;
  developerInstructions?: string;
}

interface ParseOptions {
  strict?: boolean;
}

export function normalizeCustomAgentName(name: string): string {
  return normalizeConfigName(name, ["@"]);
}

export function customAgentFileStem(name: string): string {
  return safeConfigFileStem(normalizeCustomAgentName(name));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requireName(name: string | undefined): string {
  const normalized = normalizeCustomAgentName(name ?? "");
  if (!normalized) throw new Error("Agent name is required");
  if (!customAgentFileStem(normalized)) throw new Error("Agent name is invalid");
  return normalized;
}

export function parseClaudeCustomAgent(
  content: string,
  fallbackName: string,
  options: ParseOptions = {},
): CustomAgentManifest {
  const frontmatter = parseFrontmatter(content);
  const rawName = stringValue(frontmatter.name) ?? (options.strict ? undefined : fallbackName);
  const name = requireName(rawName);
  return {
    name,
    description: stringValue(frontmatter.description),
    developerInstructions: stripFrontmatter(content).trim(),
  };
}

export function parseCodexCustomAgent(
  content: string,
  fallbackName: string,
  options: ParseOptions = {},
): CustomAgentManifest {
  const parsed = parseToml(content) as TomlTableWithoutBigInt;
  const rawName = stringValue(parsed.name) ?? (options.strict ? undefined : fallbackName);
  const name = requireName(rawName);
  const developerInstructions = stringValue(parsed.developer_instructions);

  if (options.strict && !developerInstructions) {
    throw new Error("developer_instructions is required");
  }

  return {
    name,
    description: stringValue(parsed.description),
    developerInstructions,
  };
}

export function parseCustomAgentManifest(
  provider: CustomAgentProviderId,
  content: string,
  fallbackName: string,
  options: ParseOptions = {},
): CustomAgentManifest {
  return provider === "claude"
    ? parseClaudeCustomAgent(content, fallbackName, options)
    : parseCodexCustomAgent(content, fallbackName, options);
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

export function formatClaudeCustomAgent(manifest: CustomAgentManifest): string {
  const name = requireName(manifest.name);
  const description = manifest.description?.trim();
  const body = manifest.developerInstructions?.trim() || `# ${name}\n\nDescribe this agent's role and workflow.`;
  return [
    "---",
    `name: ${yamlString(name)}`,
    ...(description ? [`description: ${yamlString(description)}`] : []),
    "---",
    "",
    body,
    "",
  ].join("\n");
}

export function formatCodexCustomAgent(manifest: CustomAgentManifest): string {
  const name = requireName(manifest.name);
  const table: TomlTableWithoutBigInt = {
    name,
    developer_instructions:
      manifest.developerInstructions?.trim() || `Describe this agent's role and workflow.`,
  };
  if (manifest.description?.trim()) {
    table.description = manifest.description.trim();
  }
  return stringifyToml(table);
}
