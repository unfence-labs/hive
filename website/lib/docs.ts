import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Docs are plain Markdown files in website/docs/ (kept portable for a future
 * dedicated docs platform). This module reads them at build time — nothing here
 * runs in the browser, so the raw files never ship to the client.
 */
export interface DocEntry {
  slug: string;
  title: string;
  description: string;
  body: string;
}

export interface DocSection {
  label: string;
  slugs: string[];
}

export const DOC_SECTIONS: DocSection[] = [
  { label: "Start here", slugs: ["overview", "core-concepts"] },
  { label: "Working with agents", slugs: ["workspaces", "sessions", "providers"] },
  { label: "Beyond the chat", slugs: ["brain", "automations", "prompts"] },
  { label: "Platform", slugs: ["notifications", "settings", "ios", "architecture"] },
];

export const ORDERED_SLUGS = DOC_SECTIONS.flatMap((section) => section.slugs);
export const DEFAULT_SLUG = ORDERED_SLUGS[0];

const DOCS_DIR = join(process.cwd(), "docs");

function parseDoc(slug: string, raw: string): DocEntry {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n/);
  let title = slug;
  let description = "";
  let body = raw;
  if (match) {
    body = raw.slice(match[0].length);
    for (const line of match[1].split("\n")) {
      const [key, ...rest] = line.split(":");
      const value = rest.join(":").trim();
      if (key.trim() === "title") title = value;
      if (key.trim() === "description") description = value;
    }
  }
  return { slug, title, description, body };
}

export function getDoc(slug: string): DocEntry | undefined {
  if (!ORDERED_SLUGS.includes(slug)) return undefined;
  try {
    const raw = readFileSync(join(DOCS_DIR, `${slug}.md`), "utf8");
    return parseDoc(slug, raw);
  } catch {
    return undefined;
  }
}

export function getDocMeta(slug: string): { slug: string; title: string } | undefined {
  const doc = getDoc(slug);
  return doc ? { slug: doc.slug, title: doc.title } : undefined;
}
