import type { WorkspaceFileTreeNode } from "@/types";

/** Stable empty expansion set shared as the initial value for file trees. */
export const DEFAULT_EXPANDED = new Set<string>();

/** Recursively count the file (non-directory) nodes in a file tree. */
export function countFiles(nodes: WorkspaceFileTreeNode[]): number {
  return nodes.reduce(
    (acc, node) =>
      node.type === "file"
        ? acc + 1
        : acc + (node.children ? countFiles(node.children) : 0),
    0,
  );
}

/** Expand the first top-level directory so the tree isn't fully collapsed on load. */
export function buildInitialExpanded(nodes: WorkspaceFileTreeNode[]): Set<string> {
  const expanded = new Set(DEFAULT_EXPANDED);
  const firstDirectory = nodes.find((node) => node.type === "directory");
  if (firstDirectory) {
    expanded.add(firstDirectory.path);
  }
  return expanded;
}

/** Depth-first search for the first file path in a tree (used to auto-select one). */
export function findFirstFilePath(nodes: WorkspaceFileTreeNode[]): string | null {
  for (const node of nodes) {
    if (node.type === "file") {
      return node.path;
    }
    if (node.children?.length) {
      const nestedFile = findFirstFilePath(node.children);
      if (nestedFile) return nestedFile;
    }
  }
  return null;
}
