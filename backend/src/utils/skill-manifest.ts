import { parseFrontmatter } from "./frontmatter.js";
import { normalizeConfigName, safeConfigFileStem } from "./config-names.js";

export interface SkillManifest {
  name: string;
  description?: string;
  argumentHint?: string;
  userInvocable: boolean;
}

export function normalizeSkillName(name: string): string {
  return normalizeConfigName(name, ["/", "$"]);
}

export function skillFolderName(name: string): string {
  return safeConfigFileStem(normalizeSkillName(name));
}

export function parseSkillManifest(content: string, fallbackName: string): SkillManifest {
  const fm = parseFrontmatter(content);
  const rawName = typeof fm.name === "string" ? fm.name : fallbackName;

  return {
    name: normalizeSkillName(rawName) || fallbackName,
    description: typeof fm.description === "string" ? fm.description : undefined,
    argumentHint: typeof fm["argument-hint"] === "string" ? fm["argument-hint"] : undefined,
    userInvocable: fm["user-invocable"] !== false,
  };
}
