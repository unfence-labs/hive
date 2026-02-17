import { join } from "node:path";
import { homedir } from "node:os";
import { access, mkdir, writeFile } from "node:fs/promises";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { git } from "../utils/git.js";
import { bareRepoPath, workspacesDir } from "../utils/paths.js";
import { pickCityName } from "../utils/city-names.js";
import { loadProject, saveProject, getDataDir, loadAllProjects, withProjectStateLock } from "../state/state.js";
import type { ChatMessage, ToolCall, ProjectState, Workspace, SessionMetadata } from "../types.js";

// ── Conductor DB path ───────────────────────────────────────────────

const DEFAULT_CONDUCTOR_DB_PATH = join(
  homedir(),
  "Library",
  "Application Support",
  "com.conductor.app",
  "conductor.db",
);

export function getConductorDbPath(): string {
  return process.env.CONDUCTOR_DB_PATH ?? DEFAULT_CONDUCTOR_DB_PATH;
}

// ── Conductor row types ─────────────────────────────────────────────

interface ConductorRepo {
  id: string;
  remote_url: string | null;
  name: string | null;
  default_branch: string | null;
  root_path: string | null;
  created_at: string;
}

interface ConductorWorkspace {
  id: string;
  repository_id: string;
  directory_name: string | null;
  branch: string | null;
  state: string | null;
  active_session_id: string | null;
  created_at: string;
}

interface ConductorSession {
  id: string;
  workspace_id: string;
  title: string | null;
  claude_session_id: string | null;
  model: string | null;
  created_at: string;
  updated_at: string;
}

interface ConductorMessage {
  id: string;
  session_id: string;
  role: string | null;
  content: string | null;
  created_at: string;
  sent_at: string | null;
  cancelled_at: string | null;
  turn_id: string | null;
}

// ── Scan result types ───────────────────────────────────────────────

export interface ConductorProjectSummary {
  id: string;
  name: string;
  remoteUrl: string;
  defaultBranch: string;
  rootPath: string | null;
  workspaceCount: number;
  sessionCount: number;
  messageCount: number;
  alreadyImported: boolean;
}

export interface ConductorScanResult {
  found: boolean;
  dbPath: string;
  projects: ConductorProjectSummary[];
  totals: {
    projects: number;
    workspaces: number;
    sessions: number;
    messages: number;
  };
}

// ── Import progress types ───────────────────────────────────────────

export type ImportProgressEvent =
  | { type: "start"; totalProjects: number; totalWorkspaces: number }
  | { type: "project_start"; projectIndex: number; projectName: string; workspaceCount: number }
  | { type: "project_cloning"; projectIndex: number; projectName: string }
  | { type: "project_cloned"; projectIndex: number; projectName: string }
  | { type: "workspace_importing"; projectIndex: number; workspaceName: string; branch: string }
  | { type: "workspace_imported"; projectIndex: number; workspaceName: string; sessionCount: number }
  | { type: "workspace_skipped"; projectIndex: number; workspaceName: string; reason: string }
  | { type: "project_done"; projectIndex: number; projectName: string }
  | { type: "done"; imported: { projects: number; workspaces: number; sessions: number } }
  | { type: "error"; message: string; projectName?: string };

export interface ImportResult {
  projects: number;
  workspaces: number;
  sessions: number;
}

// ── Scan ─────────────────────────────────────────────────────────────

export async function scanConductor(dataDir = getDataDir()): Promise<ConductorScanResult> {
  const dbPath = getConductorDbPath();

  try {
    await access(dbPath);
  } catch {
    return {
      found: false,
      dbPath,
      projects: [],
      totals: { projects: 0, workspaces: 0, sessions: 0, messages: 0 },
    };
  }

  const db = new Database(dbPath, { readonly: true });
  try {
    const repos = db.prepare("SELECT * FROM repos").all() as ConductorRepo[];

    // Load existing Hive projects to detect already-imported repos
    const hiveProjects = await loadAllProjects(dataDir);
    const hiveUrls = new Set(hiveProjects.map((p) => normalizeGitUrl(p.url)));

    const projects: ConductorProjectSummary[] = [];
    let totalWorkspaces = 0;
    let totalSessions = 0;
    let totalMessages = 0;

    for (const repo of repos) {
      if (!repo.remote_url) continue;

      const workspaces = db
        .prepare("SELECT * FROM workspaces WHERE repository_id = ? AND state IN ('active', 'ready')")
        .all(repo.id) as ConductorWorkspace[];

      const wsIds = workspaces.map((ws) => ws.id);
      let sessionCount = 0;
      let messageCount = 0;

      if (wsIds.length > 0) {
        const placeholders = wsIds.map(() => "?").join(",");
        const sessions = db
          .prepare(`SELECT id FROM sessions WHERE workspace_id IN (${placeholders})`)
          .all(...wsIds) as Array<{ id: string }>;
        sessionCount = sessions.length;

        if (sessions.length > 0) {
          const sessionIds = sessions.map((s) => s.id);
          const msgPlaceholders = sessionIds.map(() => "?").join(",");
          const msgResult = db
            .prepare(`SELECT COUNT(*) as count FROM session_messages WHERE session_id IN (${msgPlaceholders}) AND cancelled_at IS NULL`)
            .get(...sessionIds) as { count: number };
          messageCount = msgResult.count;
        }
      }

      const alreadyImported = hiveUrls.has(normalizeGitUrl(repo.remote_url));

      projects.push({
        id: repo.id,
        name: repo.name ?? extractRepoName(repo.remote_url),
        remoteUrl: repo.remote_url,
        defaultBranch: repo.default_branch ?? "main",
        rootPath: repo.root_path,
        workspaceCount: workspaces.length,
        sessionCount,
        messageCount,
        alreadyImported,
      });

      totalWorkspaces += workspaces.length;
      totalSessions += sessionCount;
      totalMessages += messageCount;
    }

    return {
      found: true,
      dbPath,
      projects,
      totals: {
        projects: projects.length,
        workspaces: totalWorkspaces,
        sessions: totalSessions,
        messages: totalMessages,
      },
    };
  } finally {
    db.close();
  }
}

// ── Import ──────────────────────────────────────────────────────────

export async function importFromConductor(
  onProgress: (event: ImportProgressEvent) => void,
  dataDir = getDataDir(),
): Promise<ImportResult> {
  const dbPath = getConductorDbPath();
  const db = new Database(dbPath, { readonly: true });

  try {
    const repos = db.prepare("SELECT * FROM repos").all() as ConductorRepo[];
    const importableRepos = repos.filter((r) => r.remote_url);

    // Load existing Hive projects to skip already-imported repos
    const hiveProjects = await loadAllProjects(dataDir);
    const hiveUrlMap = new Map<string, ProjectState>();
    for (const p of hiveProjects) {
      hiveUrlMap.set(normalizeGitUrl(p.url), p);
    }

    // Filter out already-imported repos — the scan UI already shows them as imported
    const newRepos = importableRepos.filter(
      (r) => !hiveUrlMap.has(normalizeGitUrl(r.remote_url!)),
    );

    // Count total workspaces only for new repos
    let totalWorkspaces = 0;
    for (const repo of newRepos) {
      const count = db
        .prepare("SELECT COUNT(*) as count FROM workspaces WHERE repository_id = ? AND state IN ('active', 'ready')")
        .get(repo.id) as { count: number };
      totalWorkspaces += count.count;
    }

    onProgress({ type: "start", totalProjects: newRepos.length, totalWorkspaces });

    let importedProjects = 0;
    let importedWorkspaces = 0;
    let importedSessions = 0;

    for (let pi = 0; pi < newRepos.length; pi++) {
      const repo = newRepos[pi];
      const projectName = repo.name ?? extractRepoName(repo.remote_url!);

      const workspaces = db
        .prepare("SELECT * FROM workspaces WHERE repository_id = ? AND state IN ('active', 'ready')")
        .all(repo.id) as ConductorWorkspace[];

      onProgress({
        type: "project_start",
        projectIndex: pi,
        projectName,
        workspaceCount: workspaces.length,
      });

      try {
        // Clone bare repo
        onProgress({ type: "project_cloning", projectIndex: pi, projectName });

        const projectId = `proj-${nanoid(8)}`;
        const bare = bareRepoPath(dataDir, projectId);
        const wsDir = join(dataDir, projectId, "workspaces");
        const sessionsDir = join(dataDir, projectId, "sessions");

        await mkdir(join(dataDir, projectId), { recursive: true });

        // Prefer cloning from local path (much faster) if available
        const cloneSource = await resolveCloneSource(repo);
        await git(["clone", "--bare", cloneSource, bare]);
        await mkdir(wsDir, { recursive: true });
        await mkdir(sessionsDir, { recursive: true });

        const projectState: ProjectState = {
          id: projectId,
          name: projectName,
          url: repo.remote_url!,
          createdAt: repo.created_at || new Date().toISOString(),
          workspaces: [],
        };
        await saveProject(projectState, dataDir);

        onProgress({ type: "project_cloned", projectIndex: pi, projectName });

        // Import workspaces
        for (const ws of workspaces) {
          if (!ws.branch) {
            onProgress({
              type: "workspace_skipped",
              projectIndex: pi,
              workspaceName: ws.directory_name ?? ws.id,
              reason: "no branch",
            });
            continue;
          }

          const wsName = ws.directory_name ?? ws.id;
          onProgress({
            type: "workspace_importing",
            projectIndex: pi,
            workspaceName: wsName,
            branch: ws.branch,
          });

          try {
            const sessionCount = await importWorkspace(
              db,
              ws,
              projectState,
              dataDir,
            );
            importedWorkspaces++;
            importedSessions += sessionCount;

            onProgress({
              type: "workspace_imported",
              projectIndex: pi,
              workspaceName: wsName,
              sessionCount,
            });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            onProgress({
              type: "workspace_skipped",
              projectIndex: pi,
              workspaceName: wsName,
              reason: msg,
            });
          }
        }

        importedProjects++;
        onProgress({ type: "project_done", projectIndex: pi, projectName });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        onProgress({ type: "error", message: msg, projectName });
      }
    }

    const result: ImportResult = {
      projects: importedProjects,
      workspaces: importedWorkspaces,
      sessions: importedSessions,
    };
    onProgress({ type: "done", imported: result });
    return result;
  } finally {
    db.close();
  }
}

// ── Workspace import ────────────────────────────────────────────────

async function importWorkspace(
  db: Database.Database,
  conductorWs: ConductorWorkspace,
  projectState: ProjectState,
  dataDir: string,
): Promise<number> {
  const bare = bareRepoPath(dataDir, projectState.id);
  const branch = conductorWs.branch!;

  // Check if a workspace already exists for this branch
  const existingWs = projectState.workspaces.find((ws) => ws.branch === branch);
  if (existingWs) {
    // Import sessions only, workspace already exists
    return importWorkspaceSessions(db, conductorWs, existingWs.id, projectState.id, dataDir);
  }

  // Pick a city name for the workspace
  const usedNames = projectState.workspaces.map((ws) => ws.name);
  const cityName = pickCityName(usedNames);
  const wsPath = join(workspacesDir(dataDir, projectState.id), cityName);

  // Check if branch exists in the bare repo
  const branchExists = await checkBranchExists(bare, branch);

  if (branchExists) {
    // Create worktree for existing branch
    await git(["worktree", "add", wsPath, branch], bare);
  } else {
    // Branch doesn't exist — try to find it on remote
    try {
      await git(["fetch", "origin", branch], bare);
      await git(
        ["branch", branch, `FETCH_HEAD`],
        bare,
      );
      await git(["worktree", "add", wsPath, branch], bare);
    } catch {
      // Branch not found anywhere — create from default branch
      const defaultBranch = projectState.workspaces.length > 0
        ? "main"
        : await resolveDefaultBranchSafe(bare);
      await git(["worktree", "add", "-b", branch, wsPath, defaultBranch], bare);
    }
  }

  const workspace: Workspace = {
    id: `ws-${nanoid(8)}`,
    name: cityName,
    projectId: projectState.id,
    branch,
    status: "idle",
    createdAt: conductorWs.created_at || new Date().toISOString(),
  };

  // Save workspace to project state
  await withProjectStateLock(
    projectState.id,
    async () => {
      projectState.workspaces.push(workspace);
      await saveProject(projectState, dataDir);
    },
    dataDir,
  );

  // Import sessions
  return importWorkspaceSessions(db, conductorWs, workspace.id, projectState.id, dataDir);
}

// ── Session import ──────────────────────────────────────────────────

async function importWorkspaceSessions(
  db: Database.Database,
  conductorWs: ConductorWorkspace,
  hiveWsId: string,
  hiveProjectId: string,
  dataDir: string,
): Promise<number> {
  const sessions = db
    .prepare("SELECT * FROM sessions WHERE workspace_id = ? ORDER BY created_at ASC")
    .all(conductorWs.id) as ConductorSession[];

  let imported = 0;

  for (const session of sessions) {
    try {
      await importSession(db, session, hiveWsId, hiveProjectId, dataDir);
      imported++;
    } catch {
      // Skip corrupt sessions
    }
  }

  // Update activeSessionId to the last imported session
  if (imported > 0 && sessions.length > 0) {
    const lastSession = sessions[sessions.length - 1];
    const sessionId = toHiveSessionId(lastSession.id);

    await withProjectStateLock(
      hiveProjectId,
      async () => {
        const state = await loadProject(hiveProjectId, dataDir);
        if (!state) return;
        const workspace = state.workspaces.find((w) => w.id === hiveWsId);
        if (workspace) {
          workspace.activeSessionId = sessionId;
          await saveProject(state, dataDir);
        }
      },
      dataDir,
    );
  }

  return imported;
}

async function importSession(
  db: Database.Database,
  conductorSession: ConductorSession,
  hiveWsId: string,
  hiveProjectId: string,
  dataDir: string,
): Promise<void> {
  const sessionId = toHiveSessionId(conductorSession.id);
  const sessionDir = join(dataDir, hiveProjectId, "sessions", sessionId);
  await mkdir(sessionDir, { recursive: true });

  // Convert messages
  const messages = db
    .prepare(
      `SELECT * FROM session_messages
       WHERE session_id = ? AND cancelled_at IS NULL
       ORDER BY COALESCE(sent_at, created_at) ASC`,
    )
    .all(conductorSession.id) as ConductorMessage[];

  const hiveMessages = convertConductorMessages(messages, sessionId);

  // Write messages.jsonl
  if (hiveMessages.length > 0) {
    const jsonl = hiveMessages.map((m) => JSON.stringify(m)).join("\n") + "\n";
    await writeFile(join(sessionDir, "messages.jsonl"), jsonl, "utf-8");
  }

  // Write metadata
  const metadata: SessionMetadata = {
    sessionId,
    claudeSessionId: conductorSession.claude_session_id ?? undefined,
    workspaceId: hiveWsId,
    title: conductorSession.title && conductorSession.title !== "Untitled"
      ? conductorSession.title
      : undefined,
    createdAt: conductorSession.created_at || new Date().toISOString(),
    updatedAt: conductorSession.updated_at || conductorSession.created_at || new Date().toISOString(),
    messageCount: hiveMessages.length,
  };
  await writeFile(
    join(sessionDir, "metadata.json"),
    JSON.stringify(metadata, null, 2),
    "utf-8",
  );
}

// ── Message conversion ──────────────────────────────────────────────

export function convertConductorMessages(
  messages: ConductorMessage[],
  hiveSessionId: string,
): ChatMessage[] {
  const hiveMessages: ChatMessage[] = [];
  let pendingAssistant: ChatMessage | null = null;

  for (const msg of messages) {
    if (!msg.content) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(msg.content);
    } catch {
      continue;
    }

    // System init messages → skip
    if (parsed.type === "system") continue;

    // Result messages → attach duration to pending assistant and flush
    if (parsed.type === "result") {
      if (pendingAssistant) {
        pendingAssistant.durationMs = typeof parsed.duration_ms === "number"
          ? parsed.duration_ms
          : undefined;
        hiveMessages.push(pendingAssistant);
        pendingAssistant = null;
      }
      continue;
    }

    // User messages with tool_result content → attach to pending assistant's tool calls
    if (msg.role === "user" && parsed.type === "tool_result") {
      if (pendingAssistant?.toolCalls) {
        const toolUseId = parsed.tool_use_id as string;
        const tc = pendingAssistant.toolCalls.find((t) => t.id === toolUseId);
        if (tc) {
          tc.output = typeof parsed.content === "string"
            ? parsed.content
            : JSON.stringify(parsed.content);
        }
      }
      continue;
    }

    // User messages (role array with tool_result blocks)
    if (msg.role === "user" && Array.isArray(parsed.content)) {
      // This is a tool_result array — attach each to pending assistant
      for (const block of parsed.content as Array<Record<string, unknown>>) {
        if (block.type === "tool_result" && pendingAssistant?.toolCalls) {
          const tc = pendingAssistant.toolCalls.find((t) => t.id === block.tool_use_id);
          if (tc) {
            tc.output = typeof block.content === "string"
              ? block.content
              : JSON.stringify(block.content);
          }
        }
      }
      continue;
    }

    // Regular user messages
    if (msg.role === "user" && typeof parsed.content === "string") {
      // Flush pending assistant
      if (pendingAssistant) {
        hiveMessages.push(pendingAssistant);
        pendingAssistant = null;
      }

      hiveMessages.push({
        id: `msg-${nanoid(12)}`,
        sessionId: hiveSessionId,
        role: "user",
        content: parsed.content,
        timestamp: msg.sent_at ?? msg.created_at,
      });
      continue;
    }

    // Assistant messages
    if (parsed.type === "assistant" && parsed.message) {
      // Flush pending assistant
      if (pendingAssistant) {
        hiveMessages.push(pendingAssistant);
        pendingAssistant = null;
      }

      const msgData = parsed.message as Record<string, unknown>;
      const blocks = (msgData.content ?? []) as Array<Record<string, unknown>>;

      let text = "";
      let thinking = "";
      const toolCalls: ToolCall[] = [];

      for (const block of blocks) {
        switch (block.type) {
          case "text":
            text += block.text ?? "";
            break;
          case "thinking":
            thinking += block.thinking ?? "";
            break;
          case "tool_use":
            toolCalls.push({
              id: (block.id as string) ?? nanoid(8),
              name: (block.name as string) ?? "unknown",
              input: typeof block.input === "string"
                ? block.input
                : JSON.stringify(block.input ?? {}, null, 2),
            });
            break;
        }
      }

      pendingAssistant = {
        id: `msg-${nanoid(12)}`,
        sessionId: hiveSessionId,
        role: "assistant",
        content: text,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        thinkingContent: thinking || undefined,
        timestamp: msg.sent_at ?? msg.created_at,
      };
      continue;
    }
  }

  // Flush any remaining pending assistant
  if (pendingAssistant) {
    hiveMessages.push(pendingAssistant);
  }

  return hiveMessages;
}

// ── Helpers ─────────────────────────────────────────────────────────

function normalizeGitUrl(url: string): string {
  return url
    .replace(/\.git$/, "")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//, "https://github.com/")
    .replace(/\/$/, "")
    .toLowerCase();
}

function extractRepoName(url: string): string {
  const match = url.match(/\/([^/]+?)(?:\.git)?$/);
  return match?.[1] ?? "unnamed";
}

async function resolveCloneSource(repo: ConductorRepo): Promise<string> {
  // Prefer local path for faster cloning
  if (repo.root_path) {
    try {
      await git(["rev-parse", "--git-dir"], repo.root_path);
      return repo.root_path;
    } catch {
      // Not a valid git repo, fall through to remote
    }
  }
  return repo.remote_url!;
}

async function checkBranchExists(bare: string, branch: string): Promise<boolean> {
  try {
    await git(["rev-parse", "--verify", `refs/heads/${branch}`], bare);
    return true;
  } catch {
    return false;
  }
}

async function resolveDefaultBranchSafe(bare: string): Promise<string> {
  try {
    const { stdout: headRef } = await git(["symbolic-ref", "HEAD"], bare);
    return headRef.replace("refs/heads/", "");
  } catch {
    return "main";
  }
}

function toHiveSessionId(conductorSessionId: string): string {
  // Use a deterministic but shorter ID based on the conductor ID
  // This ensures re-imports don't duplicate sessions
  return `cnd-${conductorSessionId.slice(0, 12)}`;
}
