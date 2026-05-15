import { homedir } from "node:os";
import { lstat, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { BadRequestError } from "../utils/errors.js";
import {
  ensureRelativeSymlink,
  hashContent,
  removePath,
  writeAtomic,
} from "../utils/file-sync.js";
import type {
  InstructionDetail,
  InstructionOverrideState,
  InstructionProviderId,
  InstructionProviderState,
  InstructionSyncStatus,
} from "../types.js";

export interface InstructionRoots {
  claude: string;
  codex: string;
  codexOverride: string;
}

interface ProviderInstructionEntry {
  provider: InstructionProviderId;
  path: string;
  present: true;
  isSymlink: boolean;
  realPath?: string;
  content?: string;
  hash?: string;
  updatedAt?: string;
  error?: string;
}

let instructionsLock: Promise<void> = Promise.resolve();

export function globalInstructionRoots(home = homedir()): InstructionRoots {
  return {
    claude: join(home, ".claude", "CLAUDE.md"),
    codex: join(home, ".codex", "AGENTS.md"),
    codexOverride: join(home, ".codex", "AGENTS.override.md"),
  };
}

export async function withInstructionsLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = instructionsLock;
  let release: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  instructionsLock = prev.then(() => current);

  await prev;
  try {
    return await fn();
  } finally {
    release?.();
  }
}

export function _clearInstructionsLockForTests(): void {
  instructionsLock = Promise.resolve();
}

function providerState(
  roots: InstructionRoots,
  provider: InstructionProviderId,
  entry?: ProviderInstructionEntry,
): InstructionProviderState {
  if (!entry) {
    return {
      present: false,
      path: provider === "claude" ? roots.claude : roots.codex,
    };
  }

  return {
    present: true,
    path: entry.path,
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

function hasContent(entry: ProviderInstructionEntry | undefined): boolean {
  return typeof entry?.content === "string" && entry.content.trim().length > 0;
}

function isLinked(
  claude: ProviderInstructionEntry,
  codex: ProviderInstructionEntry,
): boolean {
  return Boolean(
    claude.isSymlink &&
      claude.realPath &&
      codex.realPath &&
      claude.realPath === codex.realPath,
  );
}

async function readProviderInstruction(
  roots: InstructionRoots,
  provider: InstructionProviderId,
): Promise<ProviderInstructionEntry | undefined> {
  const path = provider === "claude" ? roots.claude : roots.codex;
  let stat;
  try {
    stat = await lstat(path);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }

  const isSymlink = stat.isSymbolicLink();
  const realPath = await realpath(path).catch(() => undefined);

  try {
    const content = await readFile(path, "utf-8");
    const fileStat = await lstat(path).catch(() => stat);
    return {
      provider,
      path,
      present: true,
      isSymlink,
      realPath,
      content,
      hash: hashContent(content),
      updatedAt: fileStat.mtime.toISOString(),
    };
  } catch (err: unknown) {
    return {
      provider,
      path,
      present: true,
      isSymlink,
      realPath,
      error: err instanceof Error ? err.message : "Unreadable instructions file",
      updatedAt: stat.mtime.toISOString(),
    };
  }
}

async function readCodexOverride(roots: InstructionRoots): Promise<InstructionOverrideState> {
  const path = roots.codexOverride;
  let stat;
  try {
    stat = await lstat(path);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { present: false, active: false, path };
    }
    throw err;
  }

  try {
    const content = await readFile(path, "utf-8");
    // Codex gives this file precedence over AGENTS.md; Hive reports it but never edits it.
    return {
      present: true,
      active: content.trim().length > 0,
      path,
      hash: hashContent(content),
      size: Buffer.byteLength(content, "utf-8"),
      updatedAt: stat.mtime.toISOString(),
    };
  } catch (err: unknown) {
    return {
      present: true,
      active: true,
      path,
      updatedAt: stat.mtime.toISOString(),
      error: err instanceof Error ? err.message : "Unreadable AGENTS.override.md",
    };
  }
}

function summarizeInstructions(
  roots: InstructionRoots,
  entries: Partial<Record<InstructionProviderId, ProviderInstructionEntry>>,
  override: InstructionOverrideState,
): InstructionDetail {
  const claude = entries.claude;
  const codex = entries.codex;
  const primary = hasContent(codex) ? codex : hasContent(claude) ? claude : codex ?? claude;

  let syncStatus: InstructionSyncStatus;
  if (!claude && !codex) {
    syncStatus = "missing";
  } else if (!primary || !hasContent(primary)) {
    syncStatus = "invalid";
  } else if (claude && codex && hasContent(claude) && hasContent(codex)) {
    if (isLinked(claude, codex)) {
      syncStatus = "linked";
    } else if (claude?.hash === codex?.hash) {
      syncStatus = "synced";
    } else {
      syncStatus = "diverged";
    }
  } else if (hasContent(claude)) {
    syncStatus = "claude_only";
  } else {
    syncStatus = "codex_only";
  }

  const contentProvider = hasContent(codex) ? "codex" : hasContent(claude) ? "claude" : null;
  const providerContents: InstructionDetail["providerContents"] = {};
  if (claude?.content !== undefined) providerContents.claude = claude.content;
  if (codex?.content !== undefined) providerContents.codex = codex.content;

  return {
    content: contentProvider ? providerContents[contentProvider] ?? "" : "",
    contentProvider,
    syncStatus,
    providers: {
      claude: providerState(roots, "claude", claude),
      codex: providerState(roots, "codex", codex),
    },
    providerContents,
    invalidReason:
      syncStatus === "invalid"
        ? primary?.error ?? "Instructions file is empty."
        : undefined,
    updatedAt: newestDate([claude?.updatedAt, codex?.updatedAt]),
    override,
  };
}

export async function loadGlobalInstructions(
  roots = globalInstructionRoots(),
): Promise<InstructionDetail> {
  const [claude, codex, override] = await Promise.all([
    readProviderInstruction(roots, "claude"),
    readProviderInstruction(roots, "codex"),
    readCodexOverride(roots),
  ]);

  return summarizeInstructions(roots, { claude, codex }, override);
}

export async function saveGlobalInstructions(
  content: string,
  roots = globalInstructionRoots(),
): Promise<InstructionDetail> {
  if (!content.trim()) throw new BadRequestError("Content is required");

  await writeAtomic(roots.codex, content);
  await ensureRelativeSymlink(roots.claude, roots.codex, "file");
  return loadGlobalInstructions(roots);
}

export async function syncGlobalInstructions(
  roots = globalInstructionRoots(),
): Promise<InstructionDetail> {
  const detail = await loadGlobalInstructions(roots);
  if (!detail.content.trim()) throw new BadRequestError("Content is required");
  return saveGlobalInstructions(detail.content, roots);
}

export async function deleteGlobalInstructions(
  roots = globalInstructionRoots(),
): Promise<boolean> {
  const detail = await loadGlobalInstructions(roots);
  const paths = new Set<string>();

  for (const provider of ["claude", "codex"] as const) {
    const state = detail.providers[provider];
    if (state.present) paths.add(state.path);
  }

  if (paths.size === 0) return false;

  for (const path of paths) {
    await removePath(path);
  }

  return true;
}
