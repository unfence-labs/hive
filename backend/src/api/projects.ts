import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import {
  createProject,
  initProject,
  listProjects,
  getProject,
  deleteProject,
  fetchProject,
} from "../projects/project-manager.js";
import { errorMessage, errorStatus } from "../utils/errors.js";
import { bareRepoPath, workspacesDir } from "../utils/paths.js";
import { getDataDir } from "../state/state.js";
import { git, gitBuffer } from "../utils/git.js";
import type { CreateProjectRequest, ProjectState } from "../types.js";

const FAVICON_NAMES = new Set(["favicon.ico", "favicon.png", "favicon.svg"]);

/** Find the first favicon path in the repo tree (recursive). */
async function findFavicon(bare: string): Promise<string | null> {
  const { stdout: tree } = await git(["ls-tree", "-r", "--name-only", "HEAD"], bare);
  for (const line of tree.split("\n")) {
    const basename = line.split("/").pop() ?? "";
    if (FAVICON_NAMES.has(basename)) return line;
  }
  return null;
}

async function hasFaviconFlag(dir: string, projectId: string): Promise<boolean> {
  try {
    return (await findFavicon(bareRepoPath(dir, projectId))) !== null;
  } catch {
    return false;
  }
}

interface WorkspaceSessionSummary {
  count: number;
  lastActivityAt?: string;
}

/** Summarize sessions per workspace by scanning the project's sessions directory once. */
async function summarizeSessionsPerWorkspace(
  dir: string,
  projectId: string,
): Promise<Map<string, WorkspaceSessionSummary>> {
  const summaries = new Map<string, WorkspaceSessionSummary>();
  const sessionsRoot = join(dir, projectId, "sessions");
  try {
    const entries = await readdir(sessionsRoot, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((e) => e.isDirectory())
        .map(async (e) => {
          try {
            const raw = await readFile(join(sessionsRoot, e.name, "metadata.json"), "utf-8");
            const meta = JSON.parse(raw) as { workspaceId?: string; updatedAt?: string };
            if (meta.workspaceId) {
              const summary = summaries.get(meta.workspaceId) ?? { count: 0 };
              summary.count += 1;
              if (meta.updatedAt && (!summary.lastActivityAt || meta.updatedAt > summary.lastActivityAt)) {
                summary.lastActivityAt = meta.updatedAt;
              }
              summaries.set(meta.workspaceId, summary);
            }
          } catch {
            // Skip unreadable metadata.
          }
        }),
    );
  } catch {
    // No sessions directory yet.
  }
  return summaries;
}

async function enrichProject(project: ProjectState, dir: string) {
  const [hasFavicon, sessionSummaries] = await Promise.all([
    hasFaviconFlag(dir, project.id),
    summarizeSessionsPerWorkspace(dir, project.id),
  ]);
  return {
    ...project,
    repoPath: bareRepoPath(dir, project.id),
    workspacesPath: workspacesDir(dir, project.id),
    hasFavicon,
    workspaces: project.workspaces.map((ws) => ({
      ...ws,
      projectName: project.name,
      sessionCount: sessionSummaries.get(ws.id)?.count ?? 0,
      lastActivityAt: sessionSummaries.get(ws.id)?.lastActivityAt,
    })),
  };
}

export async function projectRoutes(app: FastifyInstance, dataDir?: string) {
  app.post<{ Body: CreateProjectRequest }>("/api/projects", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const mode = (body.mode as string) ?? "clone";
    const dir = dataDir ?? getDataDir();

    try {
      let project: ProjectState;
      let warning: string | undefined;
      if (mode === "create") {
        const name = body.name as string | undefined;
        if (!name?.trim()) return reply.status(400).send({ error: "name is required" });
        const visibility = body.visibility as string | undefined;
        if (visibility !== undefined && visibility !== "public" && visibility !== "private") {
          return reply.status(400).send({ error: "visibility must be 'public' or 'private'" });
        }
        const result = await initProject(name, { visibility }, dir);
        project = result.state;
        warning = result.warning;
      } else {
        const url = body.url as string | undefined;
        if (!url) return reply.status(400).send({ error: "url is required" });
        project = await createProject(url, dir);
      }
      const enriched = await enrichProject(project, dir);
      return reply.status(201).send(warning ? { ...enriched, warning } : enriched);
    } catch (err: unknown) {
      return reply
        .status(errorStatus(err, 400))
        .send({ error: errorMessage(err, mode === "create" ? "Create failed" : "Clone failed") });
    }
  });

  app.get("/api/projects", async (_req, reply) => {
    const dir = dataDir ?? getDataDir();
    const projects = await listProjects(dir);
    return reply.send(await Promise.all(projects.map((p) => enrichProject(p, dir))));
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id", async (req, reply) => {
    const dir = dataDir ?? getDataDir();
    const project = await getProject(req.params.id, dir);
    if (!project) return reply.status(404).send({ error: "Project not found" });
    return reply.send(await enrichProject(project, dir));
  });

  app.delete<{ Params: { id: string } }>("/api/projects/:id", async (req, reply) => {
    const project = await getProject(req.params.id, dataDir);
    if (!project) return reply.status(404).send({ error: "Project not found" });
    if (project.workspaces.length > 0) {
      return reply.status(409).send({ error: "Cannot delete project with active workspaces" });
    }
    await deleteProject(req.params.id, dataDir);
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>("/api/projects/:id/fetch", async (req, reply) => {
    try {
      await fetchProject(req.params.id, dataDir);
      return reply.send({ status: "ok" });
    } catch (err: unknown) {
      return reply
        .status(errorStatus(err))
        .send({ error: errorMessage(err, "Fetch failed") });
    }
  });

  const EXT_MIME: Record<string, string> = {
    ".ico": "image/x-icon",
    ".png": "image/png",
    ".svg": "image/svg+xml",
  };

  app.get<{ Params: { id: string } }>("/api/projects/:id/favicon", async (req, reply) => {
    const dir = dataDir ?? getDataDir();
    const project = await getProject(req.params.id, dir);
    if (!project) return reply.status(404).send({ error: "Project not found" });

    const bare = bareRepoPath(dir, project.id);

    try {
      const path = await findFavicon(bare);
      if (path) {
        const ext = path.slice(path.lastIndexOf("."));
        const buf = await gitBuffer(["show", `HEAD:${path}`], bare);
        return reply
          .header("Content-Type", EXT_MIME[ext] ?? "application/octet-stream")
          .header("Cache-Control", "public, max-age=3600")
          .send(buf);
      }
    } catch {
      // Empty repo or git error — fall through to 404.
    }

    return reply.status(404).send({ error: "No favicon found" });
  });
}
