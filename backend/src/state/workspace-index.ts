/**
 * In-memory workspace-to-project index.
 *
 * Eliminates the O(projects × workspaces) disk scan that `getWorkspace()`
 * previously performed on every API call.  The index is populated once at
 * startup and kept in sync via `notifyProjectSaved` (called from
 * `saveProject`) and `notifyProjectDeleted` (called from `deleteProject`).
 */
import type { ProjectState, Workspace } from "../types.js";

interface IndexEntry {
  projectId: string;
  projectState: ProjectState;
  workspace: Workspace;
}

// Primary index: wsId → entry
const index = new Map<string, IndexEntry>();

// Secondary index for fast project-level deletion: projectId → Set<wsId>
const projectToWsIds = new Map<string, Set<string>>();

let initialized = false;

/**
 * Populate the index from all projects on disk.  Must be called once at
 * server startup after `reconcileStaleWorkspaces()` has run.
 */
export async function initWorkspaceIndex(
  dataDir: string,
  loader?: (dataDir: string) => Promise<ProjectState[]>,
): Promise<void> {
  // Accept an injected loader to avoid circular import at call site;
  // the default defers the import to runtime.
  const load = loader ?? (await import("./state.js")).loadAllProjects;
  const projects = await load(dataDir);
  for (const project of projects) {
    rebuildProjectEntries(project);
  }
  initialized = true;
}

export function isInitialized(): boolean {
  return initialized;
}

/**
 * O(1) workspace lookup.  Returns null when the workspace is not in the
 * index (i.e. does not exist).
 */
export function lookupWorkspace(
  wsId: string,
): { projectId: string; projectState: ProjectState; workspace: Workspace } | null {
  const entry = index.get(wsId);
  return entry ?? null;
}

/**
 * Called after every successful `saveProject()`.  Replaces all cached
 * entries for the given project with the new state snapshot.
 *
 * Safe to call before `initWorkspaceIndex()` — it is a no-op when the
 * index has not been initialized yet.
 */
export function notifyProjectSaved(state: ProjectState): void {
  if (!initialized) return;
  rebuildProjectEntries(state);
}

/**
 * Called after a project is deleted from disk.  Removes all cached entries
 * for that project.
 */
export function notifyProjectDeleted(projectId: string): void {
  if (!initialized) return;
  const wsIds = projectToWsIds.get(projectId);
  if (wsIds) {
    for (const wsId of wsIds) {
      index.delete(wsId);
    }
    projectToWsIds.delete(projectId);
  }
}

// ── internals ───────────────────────────────────────────────────────────

function rebuildProjectEntries(state: ProjectState): void {
  // Remove stale entries for this project
  const oldWsIds = projectToWsIds.get(state.id);
  if (oldWsIds) {
    for (const wsId of oldWsIds) {
      index.delete(wsId);
    }
  }

  // Insert fresh entries
  const newWsIds = new Set<string>();
  for (const workspace of state.workspaces) {
    index.set(workspace.id, {
      projectId: state.id,
      projectState: state,
      workspace,
    });
    newWsIds.add(workspace.id);
  }
  projectToWsIds.set(state.id, newWsIds);
}

// ── test helpers ────────────────────────────────────────────────────────

export function _clearForTests(): void {
  index.clear();
  projectToWsIds.clear();
  initialized = false;
}
