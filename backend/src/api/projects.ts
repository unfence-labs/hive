import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import {
  createProject,
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

/** Count sessions per workspace by scanning the project's sessions directory once. */
async function countSessionsPerWorkspace(
  dir: string,
  projectId: string,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const sessionsRoot = join(dir, projectId, "sessions");
  try {
    const entries = await readdir(sessionsRoot, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((e) => e.isDirectory())
        .map(async (e) => {
          try {
            const raw = await readFile(join(sessionsRoot, e.name, "metadata.json"), "utf-8");
            const meta = JSON.parse(raw) as { workspaceId?: string };
            if (meta.workspaceId) {
              counts.set(meta.workspaceId, (counts.get(meta.workspaceId) ?? 0) + 1);
            }
          } catch {
            // Skip unreadable metadata.
          }
        }),
    );
  } catch {
    // No sessions directory yet.
  }
  return counts;
}

async function enrichProject(project: ProjectState, dir: string) {
  const [hasFavicon, sessionCounts] = await Promise.all([
    hasFaviconFlag(dir, project.id),
    countSessionsPerWorkspace(dir, project.id),
  ]);
  return {
    ...project,
    repoPath: bareRepoPath(dir, project.id),
    workspacesPath: workspacesDir(dir, project.id),
    hasFavicon,
    workspaces: project.workspaces.map((ws) => ({
      ...ws,
      projectName: project.name,
      sessionCount: sessionCounts.get(ws.id) ?? 0,
    })),
  };
}

export async function projectRoutes(app: FastifyInstance, dataDir?: string) {
  app.post<{ Body: CreateProjectRequest }>("/api/projects", async (req, reply) => {
    const { url } = req.body ?? {};
    if (!url) return reply.status(400).send({ error: "url is required" });

    try {
      const project = await createProject(url, dataDir);
      return reply.status(201).send(project);
    } catch (err: unknown) {
      return reply
        .status(errorStatus(err, 400))
        .send({ error: errorMessage(err, "Clone failed") });
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
