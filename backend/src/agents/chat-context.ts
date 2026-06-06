import { join } from "node:path";
import { getWorkspace } from "../workspaces/workspace-manager.js";
import { loadBrainState } from "../state/brain.js";
import { getDataDir } from "../state/state.js";
import { BRAIN_WORKSPACE_ID, brainRepoPath, workspacesDir } from "../utils/paths.js";

/**
 * Resolve the working directory backing a chat context addressed by workspace id.
 *
 * The Brain (`wsId === "brain"`) maps to its normal clone; every other id maps
 * to its Git worktree. Returns `null` when the context does not exist (no Brain
 * connected, or unknown workspace). Shared by the file-mention resolver and the
 * file/`@`/`/` completion endpoints so the Brain gets the same `#`-mention and
 * autocomplete behavior as workspaces without duplicating the branch.
 */
export async function resolveChatCwd(
  wsId: string,
  dataDir = getDataDir(),
): Promise<string | null> {
  if (wsId === BRAIN_WORKSPACE_ID) {
    const state = await loadBrainState(dataDir);
    return state.exists ? brainRepoPath(dataDir) : null;
  }
  const result = await getWorkspace(wsId, dataDir);
  if (!result) return null;
  return join(workspacesDir(dataDir, result.projectState.id), result.workspace.name);
}
