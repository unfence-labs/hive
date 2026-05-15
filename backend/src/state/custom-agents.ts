import { homedir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { lstat, mkdir, readdir, readFile, realpath } from "node:fs/promises";
import { BadRequestError, ConflictError } from "../utils/errors.js";
import { hashContent, pathExists, removePath, writeAtomic } from "../utils/file-sync.js";
import {
  customAgentFileStem,
  formatClaudeCustomAgent,
  formatCodexCustomAgent,
  parseCustomAgentManifest,
  type CustomAgentManifest,
} from "../utils/custom-agent-manifest.js";
import type {
  CustomAgentDetail,
  CustomAgentListResponse,
  CustomAgentProviderId,
  CustomAgentProviderState,
  CustomAgentSummary,
} from "../types.js";

export interface CustomAgentRoots {
  claude: string;
  codex: string;
}

interface ProviderAgentEntry {
  provider: CustomAgentProviderId;
  fileName: string;
  path: string;
  present: true;
  isSymlink: boolean;
  realPath?: string;
  content?: string;
  hash?: string;
  manifest?: CustomAgentManifest;
  fallbackName: string;
  updatedAt?: string;
  error?: string;
}

interface FileEntry {
  path: string;
  relativePath: string;
}

let customAgentsLock: Promise<void> = Promise.resolve();

export function globalCustomAgentRoots(home = homedir()): CustomAgentRoots {
  return {
    claude: join(home, ".claude", "agents"),
    codex: join(home, ".codex", "agents"),
  };
}

export async function withCustomAgentsLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = customAgentsLock;
  let release: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  customAgentsLock = prev.then(() => current);

  await prev;
  try {
    return await fn();
  } finally {
    release?.();
  }
}

export function _clearCustomAgentsLockForTests(): void {
  customAgentsLock = Promise.resolve();
}

function providerRoot(roots: CustomAgentRoots, provider: CustomAgentProviderId): string {
  return provider === "claude" ? roots.claude : roots.codex;
}

function providerExtension(provider: CustomAgentProviderId): ".md" | ".toml" {
  return provider === "claude" ? ".md" : ".toml";
}

function defaultProviderPath(
  roots: CustomAgentRoots,
  provider: CustomAgentProviderId,
  id: string,
): string {
  return join(providerRoot(roots, provider), `${id}${providerExtension(provider)}`);
}

function providerState(
  roots: CustomAgentRoots,
  provider: CustomAgentProviderId,
  id: string,
  entry?: ProviderAgentEntry,
): CustomAgentProviderState {
  if (!entry) {
    return {
      present: false,
      path: defaultProviderPath(roots, provider, id),
    };
  }

  return {
    present: true,
    path: entry.path,
    fileName: entry.fileName,
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

function entryId(entry: ProviderAgentEntry): string {
  return customAgentFileStem(entry.manifest?.name ?? entry.fallbackName);
}

function manifestValidationError(
  provider: CustomAgentProviderId,
  manifest: CustomAgentManifest,
): string | undefined {
  if (provider === "codex" && !manifest.developerInstructions) {
    return "developer_instructions is required";
  }
  return undefined;
}

async function walkFiles(dir: string, extension: string, root = dir): Promise<FileEntry[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const files: FileEntry[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(fullPath, extension, root));
      continue;
    }
    if ((!entry.isFile() && !entry.isSymbolicLink()) || !entry.name.endsWith(extension)) continue;
    files.push({ path: fullPath, relativePath: relative(root, fullPath) });
  }
  return files;
}

async function readProviderAgent(
  provider: CustomAgentProviderId,
  file: FileEntry,
): Promise<ProviderAgentEntry> {
  const extension = providerExtension(provider);
  const fallbackName = basename(file.relativePath, extension);
  const stat = await lstat(file.path);
  const isSymlink = stat.isSymbolicLink();
  const realPath = await realpath(file.path).catch(() => undefined);

  try {
    const content = await readFile(file.path, "utf-8");
    const manifest = parseCustomAgentManifest(provider, content, fallbackName);
    const fileStat = await lstat(file.path).catch(() => stat);
    const error = manifestValidationError(provider, manifest);

    return {
      provider,
      fileName: file.relativePath,
      path: file.path,
      present: true,
      isSymlink,
      realPath,
      content,
      hash: hashContent(content),
      manifest,
      fallbackName,
      updatedAt: fileStat.mtime.toISOString(),
      error,
    };
  } catch (err: unknown) {
    return {
      provider,
      fileName: file.relativePath,
      path: file.path,
      present: true,
      isSymlink,
      realPath,
      fallbackName,
      error: err instanceof Error ? err.message : "Unreadable custom agent",
      updatedAt: stat.mtime.toISOString(),
    };
  }
}

async function scanProviderAgents(
  roots: CustomAgentRoots,
  provider: CustomAgentProviderId,
): Promise<ProviderAgentEntry[]> {
  const files = await walkFiles(providerRoot(roots, provider), providerExtension(provider));
  const entries: ProviderAgentEntry[] = [];
  for (const file of files) {
    entries.push(await readProviderAgent(provider, file));
  }
  return entries;
}

function summarizeGroup(
  roots: CustomAgentRoots,
  id: string,
  entries: Partial<Record<CustomAgentProviderId, ProviderAgentEntry>>,
): CustomAgentSummary {
  const claude = entries.claude;
  const codex = entries.codex;
  const primary = codex?.manifest ? codex : claude?.manifest ? claude : codex ?? claude;
  const hasClaude = Boolean(claude?.manifest);
  const hasCodex = Boolean(codex?.manifest);
  const hasError = Boolean(claude?.error || codex?.error);

  let status: CustomAgentSummary["status"];
  if (hasError || (!hasClaude && !hasCodex)) {
    status = "invalid";
  } else if (hasClaude && hasCodex) {
    status = "both";
  } else if (hasClaude) {
    status = "claude_only";
  } else {
    status = "codex_only";
  }

  return {
    id,
    name: primary?.manifest?.name ?? primary?.fallbackName ?? id,
    description: primary?.manifest?.description,
    status,
    providers: {
      claude: providerState(roots, "claude", id, claude),
      codex: providerState(roots, "codex", id, codex),
    },
    invalidReason: status === "invalid" ? claude?.error ?? codex?.error ?? "Invalid custom agent" : undefined,
    updatedAt: newestDate([claude?.updatedAt, codex?.updatedAt]),
  };
}

export async function listGlobalCustomAgents(
  roots = globalCustomAgentRoots(),
): Promise<CustomAgentListResponse> {
  const [claudeEntries, codexEntries] = await Promise.all([
    scanProviderAgents(roots, "claude"),
    scanProviderAgents(roots, "codex"),
  ]);

  const groups = new Map<string, Partial<Record<CustomAgentProviderId, ProviderAgentEntry>>>();
  for (const entry of [...claudeEntries, ...codexEntries]) {
    const id = entryId(entry);
    if (!id) continue;
    const group = groups.get(id) ?? {};
    if (!group[entry.provider]) group[entry.provider] = entry;
    groups.set(id, group);
  }

  const agents = [...groups.entries()]
    .map(([id, entries]) => summarizeGroup(roots, id, entries))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { agents };
}

export async function loadGlobalCustomAgent(
  id: string,
  roots = globalCustomAgentRoots(),
): Promise<CustomAgentDetail | null> {
  const normalizedId = customAgentFileStem(id);
  if (!normalizedId) return null;

  const { agents } = await listGlobalCustomAgents(roots);
  const summary = agents.find((agent) => agent.id === normalizedId);
  if (!summary) return null;

  const contents: CustomAgentDetail["contents"] = {};
  const manifests: CustomAgentDetail["manifests"] = {};
  for (const provider of ["claude", "codex"] as const) {
    const state = summary.providers[provider];
    if (!state.present) continue;
    try {
      const content = await readFile(state.path, "utf-8");
      contents[provider] = content;
      try {
        const manifest = parseCustomAgentManifest(provider, content, normalizedId);
        if (!manifestValidationError(provider, manifest)) {
          manifests[provider] = manifest;
        }
      } catch {
        // The raw file is still editable even when its manifest is invalid.
      }
    } catch {
      // Summary already includes provider-specific read or parse errors.
    }
  }

  return {
    ...summary,
    contents,
    manifests,
  };
}

function validateContent(
  provider: CustomAgentProviderId,
  content: string,
): CustomAgentManifest {
  if (!content.trim()) throw new BadRequestError("Content is required");
  try {
    return parseCustomAgentManifest(provider, content, "", { strict: true });
  } catch (err: unknown) {
    throw new BadRequestError(err instanceof Error ? err.message : "Invalid custom agent");
  }
}

async function writeProviderContent(
  roots: CustomAgentRoots,
  provider: CustomAgentProviderId,
  id: string,
  content: string,
  existingPath?: string,
): Promise<string> {
  const targetPath = existingPath ?? defaultProviderPath(roots, provider, id);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeAtomic(targetPath, content);
  return targetPath;
}

export async function createGlobalCustomAgent(
  provider: CustomAgentProviderId,
  content: string,
  roots = globalCustomAgentRoots(),
): Promise<CustomAgentDetail> {
  const manifest = validateContent(provider, content);
  const id = customAgentFileStem(manifest.name);
  if (!id) throw new BadRequestError("Agent name is invalid");

  const existing = await loadGlobalCustomAgent(id, roots);
  if (existing?.providers[provider].present) throw new ConflictError("Custom agent already exists");

  const targetPath = defaultProviderPath(roots, provider, id);
  if (await pathExists(targetPath)) throw new ConflictError("Custom agent already exists");

  await writeProviderContent(roots, provider, id, content);

  const created = await loadGlobalCustomAgent(id, roots);
  if (!created) throw new Error("Created custom agent could not be loaded");
  return created;
}

export async function saveGlobalCustomAgentProvider(
  id: string,
  provider: CustomAgentProviderId,
  content: string,
  roots = globalCustomAgentRoots(),
): Promise<CustomAgentDetail | null> {
  const existing = await loadGlobalCustomAgent(id, roots);
  if (!existing?.providers[provider].present) return null;

  const manifest = validateContent(provider, content);
  const nextId = customAgentFileStem(manifest.name);
  if (!nextId) throw new BadRequestError("Agent name is invalid");

  const currentState = existing.providers[provider];
  const isRename = nextId !== existing.id;
  const targetPath = isRename
    ? defaultProviderPath(roots, provider, nextId)
    : currentState.path;

  if (isRename) {
    const conflict = await loadGlobalCustomAgent(nextId, roots);
    if (conflict?.providers[provider].present || await pathExists(targetPath)) {
      throw new ConflictError("Custom agent already exists");
    }
  }

  await writeProviderContent(roots, provider, nextId, content, targetPath);
  if (isRename) await removePath(currentState.path);

  return loadGlobalCustomAgent(nextId, roots);
}

export async function deleteGlobalCustomAgentProvider(
  id: string,
  provider: CustomAgentProviderId,
  roots = globalCustomAgentRoots(),
): Promise<boolean> {
  const existing = await loadGlobalCustomAgent(id, roots);
  const state = existing?.providers[provider];
  if (!state?.present) return false;
  await removePath(state.path);
  return true;
}

export async function createGlobalCustomAgentCounterpart(
  id: string,
  targetProvider: CustomAgentProviderId,
  roots = globalCustomAgentRoots(),
): Promise<CustomAgentDetail | null> {
  const existing = await loadGlobalCustomAgent(id, roots);
  if (!existing) return null;
  if (existing.providers[targetProvider].present) {
    throw new ConflictError("Custom agent already exists");
  }

  const sourceProvider: CustomAgentProviderId = targetProvider === "claude" ? "codex" : "claude";
  const sourceManifest = existing.manifests[sourceProvider];
  if (!sourceManifest) throw new BadRequestError("Source custom agent is invalid");

  const content = targetProvider === "claude"
    ? formatClaudeCustomAgent(sourceManifest)
    : formatCodexCustomAgent(sourceManifest);
  const targetId = customAgentFileStem(sourceManifest.name);
  const targetPath = defaultProviderPath(roots, targetProvider, targetId);
  if (await pathExists(targetPath)) throw new ConflictError("Custom agent already exists");

  await writeProviderContent(roots, targetProvider, targetId, content);
  return loadGlobalCustomAgent(targetId, roots);
}
