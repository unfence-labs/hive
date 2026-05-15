import { homedir } from "node:os";
import { lstat, mkdir, readdir, readFile, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseSkillManifest, skillFolderName } from "../utils/skill-manifest.js";
import { BadRequestError, ConflictError } from "../utils/errors.js";
import {
  copyDirectoryAtomic,
  ensureRelativeSymlink,
  hashContent,
  pathExists,
  removePath,
  writeAtomic,
} from "../utils/file-sync.js";
import type {
  SkillDetail,
  SkillListResponse,
  SkillProviderId,
  SkillProviderState,
  SkillSummary,
  SkillSyncResponse,
} from "../types.js";

export interface SkillRoots {
  claude: string;
  codex: string;
}

interface ProviderSkillEntry {
  provider: SkillProviderId;
  folderName: string;
  dirPath: string;
  skillPath: string;
  present: true;
  isSymlink: boolean;
  realPath?: string;
  content?: string;
  hash?: string;
  name: string;
  description?: string;
  argumentHint?: string;
  userInvocable: boolean;
  updatedAt?: string;
  error?: string;
}

let skillsLock: Promise<void> = Promise.resolve();

export function globalSkillRoots(home = homedir()): SkillRoots {
  return {
    claude: join(home, ".claude", "skills"),
    codex: join(home, ".agents", "skills"),
  };
}

export async function withSkillsLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = skillsLock;
  let release: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  skillsLock = prev.then(() => current);

  await prev;
  try {
    return await fn();
  } finally {
    release?.();
  }
}

export function _clearSkillsLockForTests(): void {
  skillsLock = Promise.resolve();
}

function entryId(name: string): string {
  return skillFolderName(name);
}

function providerRoot(roots: SkillRoots, provider: SkillProviderId): string {
  return provider === "claude" ? roots.claude : roots.codex;
}

function providerState(
  roots: SkillRoots,
  provider: SkillProviderId,
  folderName: string,
  entry?: ProviderSkillEntry,
): SkillProviderState {
  if (!entry) {
    return {
      present: false,
      path: join(providerRoot(roots, provider), folderName),
    };
  }

  return {
    present: true,
    path: entry.dirPath,
    folderName: entry.folderName,
    isSymlink: entry.isSymlink,
    realPath: entry.realPath,
    hash: entry.hash,
    updatedAt: entry.updatedAt,
    error: entry.error,
  };
}

function newestDate(values: Array<string | undefined>): string | undefined {
  return values.filter(Boolean).sort().at(-1);
}

function isLinked(claude: ProviderSkillEntry, codex: ProviderSkillEntry): boolean {
  return Boolean(
    claude.isSymlink &&
      claude.realPath &&
      codex.realPath &&
      claude.realPath === codex.realPath,
  );
}

async function readProviderSkill(
  roots: SkillRoots,
  provider: SkillProviderId,
  folderName: string,
): Promise<ProviderSkillEntry> {
  const root = providerRoot(roots, provider);
  const dirPath = join(root, folderName);
  const skillPath = join(dirPath, "SKILL.md");
  const stat = await lstat(dirPath);
  const isSymlink = stat.isSymbolicLink();
  const realDirPath = await realpath(dirPath).catch(() => undefined);

  try {
    const content = await readFile(skillPath, "utf-8");
    const manifest = parseSkillManifest(content, folderName);
    const fileStat = await lstat(skillPath).catch(() => stat);

    return {
      provider,
      folderName,
      dirPath,
      skillPath,
      present: true,
      isSymlink,
      realPath: realDirPath,
      content,
      hash: hashContent(content),
      name: manifest.name,
      description: manifest.description,
      argumentHint: manifest.argumentHint,
      userInvocable: manifest.userInvocable,
      updatedAt: fileStat.mtime.toISOString(),
    };
  } catch (err: unknown) {
    return {
      provider,
      folderName,
      dirPath,
      skillPath,
      present: true,
      isSymlink,
      realPath: realDirPath,
      name: folderName,
      userInvocable: true,
      error: err instanceof Error ? err.message : "Unreadable skill",
      updatedAt: stat.mtime.toISOString(),
    };
  }
}

async function scanProviderSkills(roots: SkillRoots, provider: SkillProviderId): Promise<ProviderSkillEntry[]> {
  const root = providerRoot(roots, provider);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const skills: ProviderSkillEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    skills.push(await readProviderSkill(roots, provider, entry.name));
  }
  return skills;
}

function summarizeGroup(
  roots: SkillRoots,
  id: string,
  entries: Partial<Record<SkillProviderId, ProviderSkillEntry>>,
): SkillSummary {
  const claude = entries.claude;
  const codex = entries.codex;
  const primary = codex?.content ? codex : claude?.content ? claude : codex ?? claude;
  const folderName = codex?.folderName ?? claude?.folderName ?? id;
  const invalidReason = !primary?.content ? primary?.error ?? "Missing SKILL.md" : undefined;

  let syncStatus: SkillSummary["syncStatus"];
  if (!primary?.content) {
    syncStatus = "invalid";
  } else if (claude?.content && codex?.content) {
    if (isLinked(claude, codex)) {
      syncStatus = "linked";
    } else if (claude.hash === codex.hash) {
      syncStatus = "synced";
    } else {
      syncStatus = "diverged";
    }
  } else if (claude?.content) {
    syncStatus = "claude_only";
  } else {
    syncStatus = "codex_only";
  }

  return {
    id,
    name: primary?.name ?? id,
    folderName,
    description: primary?.description,
    argumentHint: primary?.argumentHint,
    userInvocable: primary?.userInvocable ?? true,
    syncStatus,
    providers: {
      claude: providerState(roots, "claude", claude?.folderName ?? folderName, claude),
      codex: providerState(roots, "codex", codex?.folderName ?? folderName, codex),
    },
    invalidReason,
    updatedAt: newestDate([claude?.updatedAt, codex?.updatedAt]),
  };
}

export async function listGlobalSkills(roots = globalSkillRoots()): Promise<SkillListResponse> {
  const [claudeEntries, codexEntries] = await Promise.all([
    scanProviderSkills(roots, "claude"),
    scanProviderSkills(roots, "codex"),
  ]);

  const groups = new Map<string, Partial<Record<SkillProviderId, ProviderSkillEntry>>>();
  for (const entry of [...claudeEntries, ...codexEntries]) {
    const id = entryId(entry.name || entry.folderName);
    if (!id) continue;
    const group = groups.get(id) ?? {};
    if (!group[entry.provider]) group[entry.provider] = entry;
    groups.set(id, group);
  }

  const skills = [...groups.entries()]
    .map(([id, entries]) => summarizeGroup(roots, id, entries))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { skills };
}

export async function loadGlobalSkill(id: string, roots = globalSkillRoots()): Promise<SkillDetail | null> {
  const normalizedId = entryId(id);
  if (!normalizedId) return null;

  const { skills } = await listGlobalSkills(roots);
  const summary = skills.find((skill) => skill.id === normalizedId);
  if (!summary) return null;

  const providerContents: SkillDetail["providerContents"] = {};
  for (const provider of ["claude", "codex"] as const) {
    const state = summary.providers[provider];
    if (!state.present) continue;
    try {
      providerContents[provider] = await readFile(join(state.path, "SKILL.md"), "utf-8");
    } catch {
      // The summary already carries provider errors; detail can still load the other side.
    }
  }

  const contentProvider: SkillProviderId = providerContents.codex !== undefined ? "codex" : "claude";
  const content = providerContents[contentProvider];
  if (content === undefined) {
    return {
      ...summary,
      content: "",
      contentProvider,
      providerContents,
    };
  }

  return {
    ...summary,
    content,
    contentProvider,
    providerContents,
  };
}

async function ensureClaudeSymlink(linkPath: string, targetDir: string): Promise<void> {
  await ensureRelativeSymlink(linkPath, targetDir, "dir");
}

/**
 * Create a brand-new canonical global skill without overwriting existing
 * Claude or Codex folders. Existing skills use saveGlobalSkill instead.
 */
export async function createGlobalSkill(
  content: string,
  roots = globalSkillRoots(),
): Promise<SkillDetail> {
  if (!content.trim()) throw new BadRequestError("Content is required");

  const manifest = parseSkillManifest(content, "");
  const folderName = entryId(manifest.name);
  if (!folderName) throw new BadRequestError("Skill name is required");

  const existing = await loadGlobalSkill(folderName, roots);
  if (existing) throw new ConflictError("Skill already exists");

  const codexDir = join(roots.codex, folderName);
  const claudeDir = join(roots.claude, folderName);
  if (await pathExists(codexDir) || await pathExists(claudeDir)) {
    throw new ConflictError("Skill already exists");
  }

  try {
    await mkdir(dirname(codexDir), { recursive: true });
    await mkdir(codexDir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new ConflictError("Skill already exists");
    }
    throw err;
  }

  try {
    await writeAtomic(join(codexDir, "SKILL.md"), content);
    await ensureClaudeSymlink(claudeDir, codexDir);
  } catch (err) {
    await removePath(codexDir).catch(() => {});
    throw err;
  }

  const created = await loadGlobalSkill(folderName, roots);
  if (!created) throw new Error("Created skill could not be loaded");
  return created;
}

/**
 * Delete every provider copy for a unified global skill. Symlinks are unlinked
 * directly so the canonical target is removed only by its own provider path.
 */
export async function deleteGlobalSkill(
  id: string,
  roots = globalSkillRoots(),
): Promise<boolean> {
  const existing = await loadGlobalSkill(id, roots);
  if (!existing) return false;

  const paths = new Set<string>();
  for (const provider of ["claude", "codex"] as const) {
    const state = existing.providers[provider];
    if (state.present) paths.add(state.path);
  }

  for (const path of paths) {
    await removePath(path);
  }

  return true;
}

export async function saveGlobalSkill(
  id: string,
  content: string,
  roots = globalSkillRoots(),
): Promise<SkillDetail | null> {
  const existing = await loadGlobalSkill(id, roots);
  if (!existing) return null;
  if (!content.trim()) throw new BadRequestError("Content is required");

  const codexFolderName = existing.providers.codex.folderName;
  const claudeFolderName = existing.providers.claude.folderName;
  const currentCanonicalFolderName = codexFolderName ?? claudeFolderName ?? existing.folderName;
  const manifest = parseSkillManifest(content, currentCanonicalFolderName);
  const nextId = entryId(manifest.name);
  if (!nextId) throw new BadRequestError("Skill name is required");
  const isRename = nextId !== existing.id;
  const canonicalFolderName = isRename ? nextId : currentCanonicalFolderName;

  if (isRename) {
    const conflict = await loadGlobalSkill(nextId, roots);
    if (conflict) throw new ConflictError("Skill already exists");
    if (await pathExists(join(roots.codex, nextId)) || await pathExists(join(roots.claude, nextId))) {
      throw new ConflictError("Skill already exists");
    }
  }

  const codexDir = join(roots.codex, canonicalFolderName);
  const codexSkillPath = join(codexDir, "SKILL.md");

  if (!existing.providers.codex.present && existing.providers.claude.present) {
    await copyDirectoryAtomic(existing.providers.claude.path, codexDir);
  } else if (isRename && existing.providers.codex.present) {
    await copyDirectoryAtomic(existing.providers.codex.path, codexDir);
  } else {
    await mkdir(codexDir, { recursive: true });
  }

  await writeAtomic(codexSkillPath, content);

  const claudeLinkName = isRename ? canonicalFolderName : claudeFolderName ?? canonicalFolderName;
  await ensureClaudeSymlink(join(roots.claude, claudeLinkName), codexDir);

  if (isRename) {
    for (const provider of ["claude", "codex"] as const) {
      const state = existing.providers[provider];
      if (!state.present) continue;
      if (state.path === codexDir || state.path === join(roots.claude, claudeLinkName)) continue;
      await removePath(state.path);
    }
  }

  return loadGlobalSkill(nextId, roots);
}

export async function syncGlobalSkill(id: string, roots = globalSkillRoots()): Promise<SkillDetail | null> {
  const detail = await loadGlobalSkill(id, roots);
  if (!detail) return null;
  if (!detail.content.trim()) throw new BadRequestError("Content is required");
  return saveGlobalSkill(id, detail.content, roots);
}

export async function syncMissingGlobalSkills(roots = globalSkillRoots()): Promise<SkillSyncResponse> {
  const before = await listGlobalSkills(roots);
  const missing = before.skills.filter(
    (skill) =>
      skill.syncStatus === "claude_only" ||
      skill.syncStatus === "codex_only" ||
      skill.syncStatus === "synced",
  );

  let syncedCount = 0;
  for (const skill of missing) {
    const synced = await syncGlobalSkill(skill.id, roots);
    if (synced) syncedCount += 1;
  }

  const after = await listGlobalSkills(roots);
  return { ...after, syncedCount };
}
