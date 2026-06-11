/**
 * Synthetic workspace id the Brain uses on workspace-keyed surfaces (hub WS
 * channel, session routes, raw-file URLs). Single source of truth shared by
 * the backend and frontend.
 */
export const BRAIN_WORKSPACE_ID = "brain";

/** API path serving a repo-relative file's raw content for a workspace (or the Brain). */
export function workspaceFileRawPath(wsId: string, filePath: string): string {
  if (wsId === BRAIN_WORKSPACE_ID) {
    return `/api/brain/file/raw?path=${encodeURIComponent(filePath)}`;
  }
  return `/api/workspaces/${encodeURIComponent(wsId)}/file/raw?path=${encodeURIComponent(filePath)}`;
}
