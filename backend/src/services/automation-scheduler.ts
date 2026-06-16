import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { Cron } from "croner";
import { nanoid } from "nanoid";
import {
  loadAutomations,
  saveAutomations,
  addRun,
  updateRun,
  loadRuns,
  withAutomationsLock,
} from "../state/automations.js";
import { loadPromptTemplates } from "../state/prompt-templates.js";
import { loadAgents } from "../state/agents.js";
import { ConversationSession } from "../agents/conversation-session.js";
import { composeAgentRunPrompt } from "./agent-run-prompt.js";
import { extractSummary } from "../utils/summary-extractor.js";
import { getNotifier } from "../agents/agent-manager.js";
import { loadProject } from "../state/state.js";
import { git } from "../utils/git.js";
import {
  addWorktreeFromBranch,
  isMissingOrNotGitRepositoryError,
  refreshWorktreeToRemoteBranch,
} from "../utils/git-worktree.js";
import { bareRepoPath, resolveDefaultBranch } from "../utils/paths.js";
import { getGitContext, formatGitContextBlock } from "../agents/system-prompt.js";
import type { Automation, AutomationRun, WsOutgoing } from "../types.js";

interface ActiveRun {
  run: AutomationRun;
  session: ConversationSession;
}

export class AutomationScheduler {
  private readonly dataDir: string;
  private readonly cronJobs = new Map<string, Cron>();
  private readonly activeRuns = new Map<string, ActiveRun>();

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  async start(): Promise<void> {
    // Recover stale running runs
    const automations = await loadAutomations(this.dataDir);
    for (const auto of automations) {
      const runs = await loadRuns(auto.id, this.dataDir);
      for (const run of runs) {
        if (run.status === "running") {
          await updateRun(
            auto.id,
            run.id,
            {
              status: "failure",
              error: "Server restarted during run",
              completedAt: new Date().toISOString(),
            },
            this.dataDir,
          );
        }
      }

      if (auto.enabled) {
        await this.scheduleAutomation(auto);
      }
    }
  }

  stop(): void {
    for (const [, cron] of this.cronJobs) {
      cron.stop();
    }
    this.cronJobs.clear();

    for (const [, active] of this.activeRuns) {
      active.session.stop();
    }
    this.activeRuns.clear();
  }

  async scheduleAutomation(auto: Automation): Promise<void> {
    this.unscheduleAutomation(auto.id);

    if (!auto.enabled) return;

    const job = new Cron(auto.trigger.expression, { legacyMode: false }, () => {
      void this.executeRun(auto.id).catch((err) => {
        console.error(`[scheduler] Error executing automation ${auto.id}:`, err);
      });
    });

    this.cronJobs.set(auto.id, job);
  }

  unscheduleAutomation(autoId: string): void {
    const existing = this.cronJobs.get(autoId);
    if (existing) {
      existing.stop();
      this.cronJobs.delete(autoId);
    }
  }

  async reschedule(auto: Automation): Promise<void> {
    this.unscheduleAutomation(auto.id);
    await this.scheduleAutomation(auto);
  }

  isRunning(autoId: string): boolean {
    return this.activeRuns.has(autoId);
  }

  async triggerNow(autoId: string): Promise<AutomationRun> {
    return this.executeRun(autoId);
  }

  async onAutomationCreated(auto: Automation): Promise<void> {
    await this.scheduleAutomation(auto);
  }

  async onAutomationUpdated(auto: Automation): Promise<void> {
    await this.reschedule(auto);
  }

  async onAutomationDeleted(autoId: string): Promise<void> {
    this.unscheduleAutomation(autoId);

    const active = this.activeRuns.get(autoId);
    if (active) {
      active.session.stop();
      this.activeRuns.delete(autoId);
    }
  }

  private async executeRun(autoId: string): Promise<AutomationRun> {
    // Guard: no concurrent runs
    if (this.activeRuns.has(autoId)) {
      console.warn(`[scheduler] Skipping run for ${autoId}: already running`);
      const existing = this.activeRuns.get(autoId)!;
      return existing.run;
    }

    // Re-load automation to get latest config
    const automations = await loadAutomations(this.dataDir);
    const auto = automations.find((a) => a.id === autoId);
    if (!auto) {
      throw new Error(`Automation ${autoId} not found`);
    }

    const now = new Date();
    const run: AutomationRun = {
      id: `run-${nanoid(8)}`,
      automationId: autoId,
      status: "running",
      sessionId: `auto-sess-${nanoid(8)}`,
      startedAt: now.toISOString(),
    };

    await addRun(autoId, run, this.dataDir);

    // Ensure workspace
    let workspacePath: string;
    let defaultBranch: string | undefined;
    try {
      ({ workspacePath, defaultBranch } = await this.ensureWorkspace(auto));
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await this.completeRun(auto, run.id, "failure", undefined, error, now);
      return { ...run, status: "failure", error };
    }

    // Update automation with workspace path if needed
    if (!auto.workspacePath) {
      await withAutomationsLock(async () => {
        const autos = await loadAutomations(this.dataDir);
        const idx = autos.findIndex((a) => a.id === autoId);
        if (idx !== -1) {
          autos[idx].workspacePath = workspacePath;
          await saveAutomations(autos, this.dataDir);
        }
      });
    }

    // Resolve the agent — the durable "who" that owns the system prompt and model.
    const agents = await loadAgents(this.dataDir);
    const agent = agents.find((a) => a.id === auto.action.agentId);
    if (!agent) {
      const error = `Agent ${auto.action.agentId} not found (deleted?)`;
      await this.completeRun(auto, run.id, "failure", undefined, error, now);
      return { ...run, status: "failure", error };
    }

    // Resolve the per-run user prompt ("what to do this run").
    const userPrompt = await this.resolveUserPrompt(auto.action.userPromptId, auto.action.userPromptInline);
    if (!userPrompt) {
      const error = "No user prompt resolved";
      await this.completeRun(auto, run.id, "failure", undefined, error, now);
      return { ...run, status: "failure", error };
    }

    // Gather a git context block for project-linked runs when the agent wants it.
    let projectName = "unknown";
    let gitContextBlock: string | null = null;
    if (auto.projectId) {
      const project = await loadProject(auto.projectId, this.dataDir);
      if (!project) {
        const error = `Project ${auto.projectId} not found (deleted?)`;
        await this.completeRun(auto, run.id, "failure", undefined, error, now);
        return { ...run, status: "failure", error };
      }
      projectName = project.name;
      if (agent.injectGitContext) {
        const ctx = await getGitContext(workspacePath, defaultBranch);
        gitContextBlock = formatGitContextBlock(ctx, { projectName });
      }
    }

    const resolvedSystemPrompt = composeAgentRunPrompt({
      agent,
      gitContextBlock,
      interpolation: {
        projectName,
        cwd: workspacePath,
        defaultBranch: defaultBranch ?? "main",
      },
    });

    // Create session. Every agent run strips interactive tools (no human is
    // subscribed to answer), and read-only agents block edits — both translated
    // to provider-specific flags inside each provider's buildArgs.
    const autoDir = join(this.dataDir, "automations", autoId);
    const session = new ConversationSession({
      cwd: workspacePath,
      dataDir: autoDir,
      workspaceId: autoId,
      sessionId: run.sessionId,
      systemPrompt: resolvedSystemPrompt,
      skipPermissions: true,
      sessionKind: "automation",
      disableInteractiveTools: true,
      readOnly: agent.readOnly,
    });

    this.activeRuns.set(autoId, { run, session });

    // Persist resolved system prompt for run log viewer
    if (resolvedSystemPrompt) {
      const sessDir = join(autoDir, "sessions", run.sessionId);
      await mkdir(sessDir, { recursive: true });
      await writeFile(join(sessDir, "system-prompt.txt"), resolvedSystemPrompt, "utf-8")
        .catch((err) => console.error("[scheduler] Persist system prompt failed:", err));
    }

    // Listen for completion
    return new Promise<AutomationRun>((resolve) => {
      let resolved = false;

      const finish = async (status: "success" | "failure", error?: string) => {
        if (resolved) return;
        resolved = true;
        this.activeRuns.delete(autoId);

        try {
          const messages = await session.getMessages();
          const summary = extractSummary(messages);
          await this.completeRun(auto, run.id, status, summary, error, now);
          resolve({ ...run, status, summary, error, completedAt: new Date().toISOString() });
        } catch (err) {
          console.error(`[scheduler] Error completing run ${run.id}:`, err);
          resolve({ ...run, status: "failure", error: String(err) });
        }
      };

      session.on("message", (msg: WsOutgoing) => {
        if (msg.type === "done") {
          void finish("success");
        } else if (msg.type === "error") {
          void finish("failure", msg.message);
        }
      });

      session.on("error", (err: Error) => {
        void finish("failure", err.message);
      });

      session.on("exit", (code: number) => {
        if (!resolved) {
          void finish(code === 0 ? "success" : "failure", code !== 0 ? `Process exited with code ${code}` : undefined);
        }
      });

      // Send the message to start the agent. The model is owned by the agent.
      try {
        session.sendMessage(userPrompt, { model: agent.modelId });
      } catch (err) {
        void finish("failure", err instanceof Error ? err.message : String(err));
      }
    });
  }

  private async ensureWorkspace(auto: Automation): Promise<{ workspacePath: string; defaultBranch?: string }> {
    const wsPath = join(this.dataDir, "automations", auto.id, "workspace");

    if (auto.projectId) {
      const project = await loadProject(auto.projectId, this.dataDir);
      if (!project) {
        throw new Error(`Project ${auto.projectId} not found`);
      }

      const bareRepo = bareRepoPath(this.dataDir, auto.projectId);

      try {
        // Check if workspace already exists by attempting git status
        await git(["status", "--porcelain"], wsPath);
        // Exists — update to latest
        const defaultBranch = await resolveDefaultBranch(bareRepo);
        await refreshWorktreeToRemoteBranch(wsPath, defaultBranch);
        return { workspacePath: wsPath, defaultBranch };
      } catch (err) {
        // Only treat "not a git repo" / missing directory as "needs worktree creation"
        if (!isMissingOrNotGitRepositoryError(err)) throw err;

        await mkdir(join(this.dataDir, "automations", auto.id), { recursive: true });
        const defaultBranch = await resolveDefaultBranch(bareRepo);
        await addWorktreeFromBranch(bareRepo, wsPath, defaultBranch);
        // Ensure first-run worktree also starts from latest remote state.
        await refreshWorktreeToRemoteBranch(wsPath, defaultBranch);
        return { workspacePath: wsPath, defaultBranch };
      }
    } else {
      // Non-project automation: just ensure directory exists
      await mkdir(wsPath, { recursive: true });
      return { workspacePath: wsPath };
    }
  }

  private async resolveUserPrompt(
    templateId: string | undefined,
    inlineContent: string | undefined,
  ): Promise<string | undefined> {
    if (templateId) {
      const templates = await loadPromptTemplates(this.dataDir);
      const tpl = templates.find((t) => t.id === templateId);
      return tpl?.content;
    }
    return inlineContent;
  }

  private async completeRun(
    auto: Automation,
    runId: string,
    status: "success" | "failure",
    summary: string | undefined,
    error: string | undefined,
    startTime: Date,
  ): Promise<void> {
    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startTime.getTime();

    await updateRun(
      auto.id,
      runId,
      { status, completedAt, durationMs, summary, error },
      this.dataDir,
    );

    // Update automation last run info
    await withAutomationsLock(async () => {
      const autos = await loadAutomations(this.dataDir);
      const idx = autos.findIndex((a) => a.id === auto.id);
      if (idx !== -1) {
        autos[idx].lastRunId = runId;
        autos[idx].lastRunAt = completedAt;
        autos[idx].lastRunStatus = status;
        autos[idx].updatedAt = completedAt;
        await saveAutomations(autos, this.dataDir);
      }
    });

    // Send notification
    const shouldNotify =
      (status === "success" && auto.notification.onComplete) ||
      (status === "failure" && auto.notification.onFailure);

    if (shouldNotify) {
      const notifier = getNotifier();
      if (notifier) {
        let projectName: string | undefined;
        if (auto.projectId) {
          const project = await loadProject(auto.projectId, this.dataDir);
          projectName = project?.name;
        }

        await notifier.notify({
          type: "automation_run_complete",
          automationId: auto.id,
          automationName: auto.name,
          projectName,
          status,
          durationMs,
          summary,
          error,
        });
      }
    }
  }
}
