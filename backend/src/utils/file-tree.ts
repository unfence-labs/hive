import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { WorkspaceFileTreeNode } from "../types.js";

/** Directories never surfaced in a recursive file tree (VCS internals, build output, deps). */
const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  // Build output
  "target", // Rust/Cargo
  "build", // Java/Gradle, C/CMake
  "dist", // JS bundlers
  ".next", // Next.js
  ".nuxt", // Nuxt
  ".svelte-kit", // SvelteKit
  ".output", // Nitro/Nuxt
  "__pycache__", // Python
  ".cache", // Various tools
  ".parcel-cache", // Parcel
  ".turbo", // Turborepo
  // Dependency/env
  ".venv", // Python virtualenv
  "venv",
  ".tox", // Python tox
  // IDE
  ".idea", // JetBrains
]);

const DEFAULT_MAX_TREE_DEPTH = 8;
const DEFAULT_MAX_TREE_NODES = 3000;

export interface BuildFileTreeOptions {
  /** Maximum directory nesting depth to walk. */
  maxDepth?: number;
  /** Maximum total nodes (files + directories) to emit before stopping. */
  maxNodes?: number;
}

function toUnixPath(path: string): string {
  return path.split(sep).join("/");
}

function sortDirEntries(
  a: { name: string; isDirectory: () => boolean },
  b: { name: string; isDirectory: () => boolean },
): number {
  if (a.isDirectory() !== b.isDirectory()) {
    return a.isDirectory() ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}

async function readTree(
  rootPath: string,
  currentPath: string,
  depth: number,
  maxDepth: number,
  remaining: { count: number },
): Promise<WorkspaceFileTreeNode[]> {
  if (depth > maxDepth || remaining.count <= 0) {
    return [];
  }

  const entries = await readdir(currentPath, { withFileTypes: true });
  entries.sort(sortDirEntries);

  const nodes: WorkspaceFileTreeNode[] = [];
  for (const entry of entries) {
    if (remaining.count <= 0) break;

    const absolutePath = join(currentPath, entry.name);
    const relativePath = toUnixPath(relative(rootPath, absolutePath));

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;

      remaining.count -= 1;
      const children = await readTree(rootPath, absolutePath, depth + 1, maxDepth, remaining);
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: "directory",
        ...(children.length > 0 ? { children } : {}),
      });
      continue;
    }

    if (!entry.isFile()) continue;

    remaining.count -= 1;
    nodes.push({
      name: entry.name,
      path: relativePath,
      type: "file",
    });
  }

  return nodes;
}

/**
 * Build a recursive file tree for a directory, skipping VCS/build/dependency
 * folders and bounding depth and total node count. Used by both workspace and
 * Brain file listings.
 */
export async function buildFileTree(
  rootPath: string,
  options: BuildFileTreeOptions = {},
): Promise<WorkspaceFileTreeNode[]> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_TREE_DEPTH;
  const remaining = { count: options.maxNodes ?? DEFAULT_MAX_TREE_NODES };
  return readTree(rootPath, rootPath, 0, maxDepth, remaining);
}
