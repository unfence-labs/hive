import type { FastifyInstance } from "fastify";
import { listProjectBranches, mapBranchesToWorkspaces } from "../workspaces/workspace-sources.js";
import { listOpenPullRequests, listOpenIssues, parseGitHubRepo } from "../utils/github.js";
import { loadProject, getDataDir } from "../state/state.js";
import { bareRepoPath } from "../utils/paths.js";
import { errorMessage, errorStatus } from "../utils/errors.js";
import type { ProjectState } from "../types.js";

const NO_GITHUB_REMOTE = "This project has no GitHub remote";

async function loadGitHubProject(
  projectId: string,
  dataDir: string,
): Promise<{ state: ProjectState; repo: { owner: string; repo: string } | null } | null> {
  const state = await loadProject(projectId, dataDir);
  if (!state) return null;
  const repo = state.url ? parseGitHubRepo(state.url) : null;
  return { state, repo };
}

export async function workspaceSourceRoutes(app: FastifyInstance, dataDir?: string) {
  app.get<{ Params: { id: string } }>("/api/projects/:id/branches", async (req, reply) => {
    try {
      const branches = await listProjectBranches(req.params.id, dataDir);
      return reply.send({ branches });
    } catch (err: unknown) {
      return reply
        .status(errorStatus(err))
        .send({ error: errorMessage(err, "Failed to list branches") });
    }
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id/pulls", async (req, reply) => {
    const dir = dataDir ?? getDataDir();
    const loaded = await loadGitHubProject(req.params.id, dir);
    if (!loaded) return reply.status(404).send({ error: "Project not found" });
    if (!loaded.repo) return reply.send({ pulls: [], error: NO_GITHUB_REMOTE });
    try {
      const entries = await listOpenPullRequests(loaded.repo.owner, loaded.repo.repo);
      const bare = bareRepoPath(dir, req.params.id);
      const workspaceByBranch = await mapBranchesToWorkspaces(loaded.state, bare, dir);
      const pulls = entries.map((entry) => {
        const ws = workspaceByBranch.get(entry.headRefName);
        return {
          number: entry.number,
          title: entry.title,
          branch: entry.headRefName,
          url: entry.url,
          isDraft: entry.isDraft,
          author: entry.author,
          updatedAt: entry.updatedAt,
          ...(ws ? { workspaceId: ws.id, workspaceName: ws.name } : {}),
        };
      });
      return reply.send({ pulls });
    } catch (err: unknown) {
      return reply.send({ pulls: [], error: errorMessage(err, "Failed to list pull requests") });
    }
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id/issues", async (req, reply) => {
    const dir = dataDir ?? getDataDir();
    const loaded = await loadGitHubProject(req.params.id, dir);
    if (!loaded) return reply.status(404).send({ error: "Project not found" });
    if (!loaded.repo) return reply.send({ issues: [], error: NO_GITHUB_REMOTE });
    try {
      const issues = await listOpenIssues(loaded.repo.owner, loaded.repo.repo);
      return reply.send({ issues });
    } catch (err: unknown) {
      return reply.send({ issues: [], error: errorMessage(err, "Failed to list issues") });
    }
  });
}
