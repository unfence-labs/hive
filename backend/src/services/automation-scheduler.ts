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
import { ConversationSession } from "../agents/conversation-session.js";
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
import { getGitContext, formatGitContextBlock, interpolatePromptVariables } from "../agents/system-prompt.js";
import { interpolateGitHubVariables, type GitHubEventContext } from "../agents/github-prompt-context.js";
import { parseGitHubRepo, postPrComment, postIssueComment } from "../utils/github.js";
import { loadConfig } from "../state/config.js";
import type { CleanupService } from "./cleanup-service.js";
import type { Automation, AutomationRun, GitHubTriggerEvent, WsOutgoing } from "../types.js";

const SUMMARY_INSTRUCTION =
  "\n\nIMPORTANT: End your final message with a \"## Summary\" section that concisely summarizes your findings and actions. This summary will be sent as a notification.";

interface ActiveRun {
  run: AutomationRun;
  session: ConversationSession;
}

export class AutomationScheduler {
  private readonly dataDir: string;
  private readonly cronJobs = new Map<string, Cron>();
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly cleanupService?: CleanupService;

  constructor(dataDir: string, cleanupService?: CleanupService) {
    this.dataDir = dataDir;
    this.cleanupService = cleanupService;
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

    if (auto.trigger.type !== "cron") return;

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

    // Guard: disk pressure
    if (this.cleanupService?.isBlocked()) {
      console.warn(`[scheduler] Skipping run for ${autoId}: disk pressure`);
      const run: AutomationRun = {
        id: `run-${nanoid(8)}`,
        automationId: autoId,
        status: "failure",
        sessionId: "",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        error: "Disk pressure too high — cleanup required",
      };
      await addRun(autoId, run, this.dataDir);
      return run;
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

    // Resolve prompts
    let systemPrompt = await this.resolvePrompt(auto.action.systemPromptId, auto.action.systemPromptInline, "system");
    const userPrompt = await this.resolvePrompt(auto.action.userPromptId, auto.action.userPromptInline, "user");

    if (!userPrompt) {
      const error = "No user prompt resolved";
      await this.completeRun(auto, run.id, "failure", undefined, error, now);
      return { ...run, status: "failure", error };
    }

    // Inject git context for project-linked automations
    let projectName = "unknown";
    if (auto.projectId) {
      const project = await loadProject(auto.projectId, this.dataDir);
      if (!project) {
        const error = `Project ${auto.projectId} not found (deleted?)`;
        await this.completeRun(auto, run.id, "failure", undefined, error, now);
        return { ...run, status: "failure", error };
      }
      projectName = project.name;
      const ctx = await getGitContext(workspacePath, defaultBranch);
      const gitBlock = formatGitContextBlock(ctx, { projectName });
      systemPrompt = systemPrompt ? systemPrompt + "\n\n" + gitBlock : gitBlock;
    }

    // Interpolate template variables
    if (systemPrompt) {
      systemPrompt = interpolatePromptVariables(systemPrompt, {
        projectName,
        cwd: workspacePath,
        defaultBranch: defaultBranch ?? "main",
      });
    }

    return this.startRunSession(auto, run, workspacePath, systemPrompt, userPrompt, now);
  }

  async executeEventRun(
    autoId: string,
    event: GitHubTriggerEvent,
    eventContext: GitHubEventContext,
  ): Promise<AutomationRun> {
    // Guard: no concurrent runs
    if (this.activeRuns.has(autoId)) {
      throw new Error(`Automation ${autoId} is already running`);
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
      triggerEvent: event,
    };

    await addRun(autoId, run, this.dataDir);

    // Ensure workspace (checkout PR branch for PR events)
    let workspacePath: string;
    let defaultBranch: string | undefined;
    try {
      ({ workspacePath, defaultBranch } = await this.ensureWorkspaceForEvent(auto, event));
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await this.completeRun(auto, run.id, "failure", undefined, error, now, event);
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

    // Resolve prompts
    let systemPrompt = await this.resolvePrompt(auto.action.systemPromptId, auto.action.systemPromptInline, "system");
    let userPrompt = await this.resolvePrompt(auto.action.userPromptId, auto.action.userPromptInline, "user");

    if (!userPrompt) {
      const error = "No user prompt resolved";
      await this.completeRun(auto, run.id, "failure", undefined, error, now, event);
      return { ...run, status: "failure", error };
    }

    // Inject git context for project-linked automations
    let projectName = "unknown";
    if (auto.projectId) {
      const project = await loadProject(auto.projectId, this.dataDir);
      if (!project) {
        const error = `Project ${auto.projectId} not found (deleted?)`;
        await this.completeRun(auto, run.id, "failure", undefined, error, now, event);
        return { ...run, status: "failure", error };
      }
      projectName = project.name;
      const ctx = await getGitContext(workspacePath, defaultBranch);
      const gitBlock = formatGitContextBlock(ctx, { projectName });
      systemPrompt = systemPrompt ? systemPrompt + "\n\n" + gitBlock : gitBlock;
    }

    // Interpolate template variables
    if (systemPrompt) {
      systemPrompt = interpolatePromptVariables(systemPrompt, {
        projectName,
        cwd: workspacePath,
        defaultBranch: defaultBranch ?? "main",
      });
    }

    // Inject previous review summary for same PR/issue
    const runs = await loadRuns(autoId, this.dataDir);
    const previousRun = runs
      .filter((r) => r.status === "success" && r.triggerEvent?.number === event.number && r.id !== run.id)
      .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))[0];
    if (previousRun?.summary) {
      eventContext.previousReviewSummary = previousRun.summary;
    }

    // Interpolate GitHub variables into both prompts
    if (systemPrompt) {
      systemPrompt = interpolateGitHubVariables(systemPrompt, eventContext);
    }
    userPrompt = interpolateGitHubVariables(userPrompt, eventContext);

    return this.startRunSession(auto, run, workspacePath, systemPrompt, userPrompt, now, event);
  }

  private startRunSession(
    auto: Automation,
    run: AutomationRun,
    workspacePath: string,
    systemPrompt: string | undefined,
    userPrompt: string,
    startTime: Date,
    triggerEvent?: GitHubTriggerEvent,
  ): Promise<AutomationRun> {
    const autoDir = join(this.dataDir, "automations", auto.id);
    const session = new ConversationSession({
      cwd: workspacePath,
      dataDir: autoDir,
      workspaceId: auto.id,
      sessionId: run.sessionId,
      systemPrompt: systemPrompt ? systemPrompt + SUMMARY_INSTRUCTION : undefined,
      skipPermissions: true,
    });

    this.activeRuns.set(auto.id, { run, session });

    // Persist resolved system prompt for run log viewer
    const persistPrompt = systemPrompt
      ? (async () => {
          const sessDir = join(autoDir, "sessions", run.sessionId);
          await mkdir(sessDir, { recursive: true });
          await writeFile(join(sessDir, "system-prompt.txt"), systemPrompt, "utf-8");
        })().catch((err) => console.error("[scheduler] Persist system prompt failed:", err))
      : Promise.resolve();

    return new Promise<AutomationRun>((resolve) => {
      let resolved = false;

      const finish = async (status: "success" | "failure", error?: string) => {
        if (resolved) return;
        resolved = true;
        this.activeRuns.delete(auto.id);

        try {
          const messages = await session.getMessages();
          const summary = extractSummary(messages);
          await this.completeRun(auto, run.id, status, summary, error, startTime, triggerEvent);
          resolve({ ...run, status, summary, error, completedAt: new Date().toISOString(), triggerEvent });
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

      // Send the message to start the agent
      void persistPrompt.then(() => {
        try {
          session.sendMessage(userPrompt, { model: auto.action.modelId });
        } catch (err) {
          void finish("failure", err instanceof Error ? err.message : String(err));
        }
      });
    });
  }

  private async ensureWorkspaceForEvent(
    auto: Automation,
    event: GitHubTriggerEvent,
  ): Promise<{ workspacePath: string; defaultBranch?: string }> {
    // For issue events, fall back to standard workspace setup
    if (!event.type.startsWith("pull_request.")) {
      return this.ensureWorkspace(auto);
    }

    // For PR events, ensure workspace and checkout the PR branch
    const { workspacePath, defaultBranch } = await this.ensureWorkspace(auto);

    // Clean up any stale pr-review branch from a previous run
    await git(["checkout", defaultBranch ?? "main"], workspacePath).catch(() => {});
    await git(["branch", "-D", "pr-review"], workspacePath).catch(() => {});

    // Fetch and checkout the PR branch
    await git(
      ["fetch", "origin", `pull/${event.number}/head:pr-review`, "--force"],
      workspacePath,
    );
    await git(["checkout", "pr-review"], workspacePath);
    if (event.headSha) {
      await git(["reset", "--hard", event.headSha], workspacePath);
    }

    return { workspacePath, defaultBranch };
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

  private async resolvePrompt(
    templateId: string | undefined,
    inlineContent: string | undefined,
    _type: "system" | "user",
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
    triggerEvent?: GitHubTriggerEvent,
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

    // Post result as GitHub comment if configured
    if (auto.action.postResultAsComment && triggerEvent && status === "success") {
      const project = auto.projectId ? await loadProject(auto.projectId, this.dataDir) : null;
      const ghRepo = project ? parseGitHubRepo(project.url) : null;
      if (ghRepo) {
        const comment = `### Hive: ${auto.name}\n\n${summary ?? "_No summary_"}`;
        try {
          if (triggerEvent.type.startsWith("pull_request.")) {
            await postPrComment(ghRepo.owner, ghRepo.repo, triggerEvent.number, comment);
          } else if (triggerEvent.type.startsWith("issues.")) {
            await postIssueComment(ghRepo.owner, ghRepo.repo, triggerEvent.number, comment);
          }
        } catch (err) {
          console.error(`[scheduler] Failed to post comment:`, err);
        }
      }
    }

    // Post-run artifact strip
    if (this.cleanupService && auto.workspacePath) {
      try {
        const config = await loadConfig(this.dataDir);
        if (config.cleanup.postRunArtifactStrip) {
          await this.cleanupService.stripArtifacts(auto.workspacePath);
        }
      } catch (err) {
        console.error("[scheduler] Post-run artifact strip failed:", err);
      }
    }
  }
}
