/**
 * Lightweight YAML frontmatter parser for SKILL.md and agent .md files.
 * Handles the flat key-value subset used by Claude Code: strings, booleans,
 * and bracket/comma-separated arrays. No external dependency needed.
 */

export interface Frontmatter {
  [key: string]: string | boolean | string[];
}

export function parseFrontmatter(content: string): Frontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const result: Frontmatter = {};

  for (const line of match[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    let value = trimmed.slice(colonIdx + 1).trim();

    if (!key || !value) continue;

    // Boolean
    if (value === "true") {
      result[key] = true;
      continue;
    }
    if (value === "false") {
      result[key] = false;
      continue;
    }

    // Bracket array: [Task, Read, Glob]
    if (value.startsWith("[") && value.endsWith("]")) {
      result[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      continue;
    }

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // YAML folded scalar indicator (>) — just store what follows on this line
    if (value === ">") {
      value = "";
    }

    // Comma-separated string that looks like an array (e.g. "Read, Grep, Glob")
    // Heuristic: contains commas and no spaces-without-commas pattern typical of prose
    if (key === "allowed-tools" && value.includes(",")) {
      result[key] = value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      continue;
    }

    result[key] = value;
  }

  return result;
}
