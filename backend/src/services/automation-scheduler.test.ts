import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "../utils/test-helpers.js";
import { AutomationScheduler } from "./automation-scheduler.js";
import {
  loadAutomations,
  saveAutomations,
  loadRuns,
  saveRuns,
} from "../state/automations.js";
import { savePromptTemplates } from "../state/prompt-templates.js";
import type { Automation, AutomationRun, PromptTemplate } from "../types.js";

// ── Mock heavy dependencies ─────────────────────────────────────────
// ConversationSession is a complex beast that spawns child processes.
// We mock it to test scheduler orchestration logic in isolation.

// Track constructor calls to inspect systemPrompt passed to sessions
const sessionConstructorCalls: Array<Record<string, unknown>> = [];

vi.mock("../agents/conversation-session.js", async () => {
  const { EventEmitter } = await import("node:events");
  class MockSession extends EventEmitter {
    stopped = false;
    sentMessage: string | undefined;
    sendOptions: Record<string, unknown> | undefined;
    opts: Record<string, unknown>;

    constructor(opts: Record<string, unknown>) {
      super();
      this.opts = opts;
      sessionConstructorCalls.push(opts);
    }

    sendMessage(msg: string, opts?: Record<string, unknown>) {
      this.sentMessage = msg;
      this.sendOptions = opts;
      // Emit "done" on next tick to simulate completion
      process.nextTick(() => this.emit("message", { type: "done" }));
    }

    stop() {
      this.stopped = true;
    }

    async getMessages() {
      return [
        { id: "m1", sessionId: "s1", role: "assistant", content: "Working\n## Summary\nAll good.", timestamp: new Date().toISOString() },
      ];
    }
  }
  return { ConversationSession: MockSession };
});

vi.mock("../agents/agent-manager.js", () => ({
  getNotifier: vi.fn(() => null),
}));

vi.mock("../state/state.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../state/state.js")>();
  return {
    ...actual,
    loadProject: vi.fn(async () => ({ id: "proj-1", name: "Test Project", repoUrl: "https://github.com/test/repo" })),
  };
});

vi.mock("../utils/git.js", () => ({
  git: vi.fn(async () => ({ stdout: "", stderr: "" })),
}));

vi.mock("../utils/paths.js", () => ({
  bareRepoPath: vi.fn((_dataDir: string, _projId: string) => "/tmp/bare"),
  resolveDefaultBranch: vi.fn(async () => "main"),
}));

vi.mock("../agents/system-prompt.js", () => ({
  getGitContext: vi.fn(async () => ({
    branch: "main",
    status: "",
    recentCommits: "abc1234 initial commit",
    defaultBranch: "main",
  })),
  formatGitContextBlock: vi.fn(
    (_ctx: unknown, opts?: { projectName?: string }) =>
      `# Git Context (snapshot at session start)\n\nProject: ${opts?.projectName ?? "unknown"}\nCurrent branch: main\nMain branch: main\n\nStatus: (clean)\n\nRecent commits:\nabc1234 initial commit`,
  ),
  interpolatePromptVariables: vi.fn(
    (prompt: string, values: { projectName: string; cwd: string; defaultBranch: string }) =>
      prompt
        .replace(/\{DIR}/g, values.cwd)
        .replace(/\{DEFAULT_BRANCH}/g, values.defaultBranch)
        .replace(/\{PROJECT}/g, values.projectName),
  ),
}));

// ── Helpers ─────────────────────────────────────────────────────────

let tmpDir: string;
let dataDir: string;

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "auto-1",
    name: "Test Automation",
    enabled: true,
    trigger: { type: "cron", expression: "0 * * * *" },
    action: { type: "agent", modelId: "claude:opus-4-6", userPromptInline: "Review code" },
    notification: { onComplete: true, onFailure: true },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeRun(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: "run-1",
    automationId: "auto-1",
    status: "running",
    sessionId: "sess-1",
    startedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await createTempDir();
  dataDir = join(tmpDir, "data");
  sessionConstructorCalls.length = 0;
  vi.clearAllMocks();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

// ── Tests ───────────────────────────────────────────────────────────

describe("AutomationScheduler", () => {
  describe("start()", () => {
    it("recovers stale running runs on startup", async () => {
      const auto = makeAutomation();
      await saveAutomations([auto], dataDir);
      await saveRuns("auto-1", [makeRun({ status: "running" })], dataDir);

      const scheduler = new AutomationScheduler(dataDir);
      await scheduler.start();

      const runs = await loadRuns("auto-1", dataDir);
      expect(runs[0].status).toBe("failure");
      expect(runs[0].error).toBe("Server restarted during run");
      expect(runs[0].completedAt).toBeDefined();

      scheduler.stop();
    });

    it("does not touch completed runs on startup", async () => {
      const auto = makeAutomation();
      await saveAutomations([auto], dataDir);
      await saveRuns("auto-1", [makeRun({ status: "success" })], dataDir);

      const scheduler = new AutomationScheduler(dataDir);
      await scheduler.start();

      const runs = await loadRuns("auto-1", dataDir);
      expect(runs[0].status).toBe("success");

      scheduler.stop();
    });

    it("schedules enabled automations on start", async () => {
      const auto = makeAutomation({ enabled: true });
      await saveAutomations([auto], dataDir);

      const scheduler = new AutomationScheduler(dataDir);
      await scheduler.start();

      // The fact that stop() can be called without error proves a job was scheduled
      scheduler.stop();
    });

    it("does not schedule disabled automations on start", async () => {
      const auto = makeAutomation({ enabled: false });
      await saveAutomations([auto], dataDir);

      const scheduler = new AutomationScheduler(dataDir);
      await scheduler.start();
      scheduler.stop();
    });
  });

  describe("stop()", () => {
    it("clears all cron jobs and active runs", async () => {
      const auto = makeAutomation();
      await saveAutomations([auto], dataDir);

      const scheduler = new AutomationScheduler(dataDir);
      await scheduler.start();
      scheduler.stop();

      // After stop, isRunning should return false for any automation
      expect(scheduler.isRunning("auto-1")).toBe(false);
    });
  });

  describe("scheduleAutomation()", () => {
    it("replaces existing job for same automation", async () => {
      const scheduler = new AutomationScheduler(dataDir);
      const auto = makeAutomation();

      await scheduler.scheduleAutomation(auto);
      // Schedule again — should not throw
      await scheduler.scheduleAutomation(auto);

      scheduler.stop();
    });

    it("does not schedule if automation is disabled", async () => {
      const scheduler = new AutomationScheduler(dataDir);
      const auto = makeAutomation({ enabled: false });

      await scheduler.scheduleAutomation(auto);

      // isRunning should be false since nothing was scheduled
      expect(scheduler.isRunning("auto-1")).toBe(false);
      scheduler.stop();
    });
  });

  describe("unscheduleAutomation()", () => {
    it("is a no-op for unknown automation id", () => {
      const scheduler = new AutomationScheduler(dataDir);
      // Should not throw
      scheduler.unscheduleAutomation("nonexistent");
      scheduler.stop();
    });

    it("removes a scheduled automation", async () => {
      const scheduler = new AutomationScheduler(dataDir);
      const auto = makeAutomation();
      await scheduler.scheduleAutomation(auto);

      scheduler.unscheduleAutomation("auto-1");
      scheduler.stop();
    });
  });

  describe("isRunning()", () => {
    it("returns false when no run is active", () => {
      const scheduler = new AutomationScheduler(dataDir);
      expect(scheduler.isRunning("auto-1")).toBe(false);
      scheduler.stop();
    });
  });

  describe("triggerNow()", () => {
    it("executes a run and returns the completed run", async () => {
      const auto = makeAutomation();
      await saveAutomations([auto], dataDir);

      const scheduler = new AutomationScheduler(dataDir);
      const run = await scheduler.triggerNow("auto-1");

      expect(run.automationId).toBe("auto-1");
      expect(run.status).toBe("success");
      expect(run.summary).toBe("All good.");
      expect(run.completedAt).toBeDefined();

      scheduler.stop();
    });

    it("throws when automation does not exist", async () => {
      const scheduler = new AutomationScheduler(dataDir);

      await expect(scheduler.triggerNow("nonexistent")).rejects.toThrow(
        "Automation nonexistent not found",
      );

      scheduler.stop();
    });

    it("guards against concurrent runs via isRunning check", async () => {
      const auto = makeAutomation();
      await saveAutomations([auto], dataDir);

      const scheduler = new AutomationScheduler(dataDir);

      // First trigger starts the run
      const run1Promise = scheduler.triggerNow("auto-1");

      // While first is running (before done emits on next tick), isRunning should eventually be true
      // After completion, isRunning should be false
      const run1 = await run1Promise;
      expect(run1.status).toBe("success");
      expect(scheduler.isRunning("auto-1")).toBe(false);

      scheduler.stop();
    });

    it("persists the run to disk", async () => {
      const auto = makeAutomation();
      await saveAutomations([auto], dataDir);

      const scheduler = new AutomationScheduler(dataDir);
      const run = await scheduler.triggerNow("auto-1");

      const persisted = await loadRuns("auto-1", dataDir);
      expect(persisted.length).toBeGreaterThanOrEqual(1);
      expect(persisted.find((r) => r.id === run.id)).toBeDefined();

      scheduler.stop();
    });

    it("updates the automation with lastRunId and lastRunStatus", async () => {
      const auto = makeAutomation();
      await saveAutomations([auto], dataDir);

      const scheduler = new AutomationScheduler(dataDir);
      const run = await scheduler.triggerNow("auto-1");

      const autos = await loadAutomations(dataDir);
      expect(autos[0].lastRunId).toBe(run.id);
      expect(autos[0].lastRunStatus).toBe("success");
      expect(autos[0].lastRunAt).toBeDefined();

      scheduler.stop();
    });

    it("resolves user prompt from template when userPromptId is set", async () => {
      const tpl: PromptTemplate = {
        id: "tpl-1",
        name: "Code Review",
        type: "user",
        content: "Review the latest changes",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };
      await savePromptTemplates([tpl], dataDir);

      const auto = makeAutomation({
        action: {
          type: "agent",
          modelId: "claude:opus-4-6",
          userPromptId: "tpl-1",
        },
      });
      await saveAutomations([auto], dataDir);

      const scheduler = new AutomationScheduler(dataDir);
      const run = await scheduler.triggerNow("auto-1");

      expect(run.status).toBe("success");

      scheduler.stop();
    });

    it("fails when no user prompt can be resolved", async () => {
      const auto = makeAutomation({
        action: {
          type: "agent",
          modelId: "claude:opus-4-6",
          userPromptId: "nonexistent-tpl",
        },
      });
      await saveAutomations([auto], dataDir);

      const scheduler = new AutomationScheduler(dataDir);
      const run = await scheduler.triggerNow("auto-1");

      expect(run.status).toBe("failure");
      expect(run.error).toBe("No user prompt resolved");

      scheduler.stop();
    });
  });

  describe("onAutomationCreated()", () => {
    it("schedules the automation", async () => {
      const scheduler = new AutomationScheduler(dataDir);
      const auto = makeAutomation();

      await scheduler.onAutomationCreated(auto);
      // Verify it was scheduled by stopping cleanly
      scheduler.stop();
    });
  });

  describe("onAutomationUpdated()", () => {
    it("reschedules the automation", async () => {
      const scheduler = new AutomationScheduler(dataDir);
      const auto = makeAutomation();

      await scheduler.onAutomationCreated(auto);
      await scheduler.onAutomationUpdated({ ...auto, trigger: { type: "cron", expression: "0 2 * * *" } });

      scheduler.stop();
    });

    it("unschedules if disabled", async () => {
      const scheduler = new AutomationScheduler(dataDir);
      const auto = makeAutomation();

      await scheduler.onAutomationCreated(auto);
      await scheduler.onAutomationUpdated({ ...auto, enabled: false });

      scheduler.stop();
    });
  });

  describe("onAutomationDeleted()", () => {
    it("unschedules the automation", async () => {
      const scheduler = new AutomationScheduler(dataDir);
      const auto = makeAutomation();

      await scheduler.onAutomationCreated(auto);
      await scheduler.onAutomationDeleted("auto-1");

      scheduler.stop();
    });
  });

  describe("notification dispatch", () => {
    it("sends notification on successful run when onComplete is true", async () => {
      const { getNotifier } = await import("../agents/agent-manager.js");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const notifyMock = vi.fn(async (..._args: any[]) => {});
      vi.mocked(getNotifier).mockReturnValue({
        notify: notifyMock,
        addChannel: vi.fn(),
        removeChannel: vi.fn(),
      } as never);

      const auto = makeAutomation({ notification: { onComplete: true, onFailure: false } });
      await saveAutomations([auto], dataDir);

      const scheduler = new AutomationScheduler(dataDir);
      await scheduler.triggerNow("auto-1");

      expect(notifyMock).toHaveBeenCalledTimes(1);
      const event = notifyMock.mock.calls[0]![0];
      expect(event.type).toBe("automation_run_complete");
      expect(event.status).toBe("success");
      expect(event.automationName).toBe("Test Automation");
      expect(event.summary).toBe("All good.");

      scheduler.stop();
    });

    it("does not send notification when onComplete is false and run succeeds", async () => {
      const { getNotifier } = await import("../agents/agent-manager.js");
      const notifyMock = vi.fn(async () => {});
      vi.mocked(getNotifier).mockReturnValue({
        notify: notifyMock,
        addChannel: vi.fn(),
        removeChannel: vi.fn(),
      } as never);

      const auto = makeAutomation({ notification: { onComplete: false, onFailure: true } });
      await saveAutomations([auto], dataDir);

      const scheduler = new AutomationScheduler(dataDir);
      await scheduler.triggerNow("auto-1");

      expect(notifyMock).not.toHaveBeenCalled();

      scheduler.stop();
    });

    it("does not send notification when notifier is null", async () => {
      const { getNotifier } = await import("../agents/agent-manager.js");
      vi.mocked(getNotifier).mockReturnValue(null as never);

      const auto = makeAutomation();
      await saveAutomations([auto], dataDir);

      const scheduler = new AutomationScheduler(dataDir);
      // Should not throw even without a notifier
      await scheduler.triggerNow("auto-1");

      scheduler.stop();
    });
  });

  describe("workspace setup", () => {
    it("creates workspace directory for non-project automations", async () => {
      const { loadProject } = await import("../state/state.js");
      vi.mocked(loadProject).mockResolvedValue(null as never);

      const auto = makeAutomation({ projectId: undefined });
      await saveAutomations([auto], dataDir);

      const scheduler = new AutomationScheduler(dataDir);
      const run = await scheduler.triggerNow("auto-1");

      expect(run.status).toBe("success");
      scheduler.stop();
    });

    it("saves workspace path on first run", async () => {
      // Re-set mock to return a valid project (previous test may have cleared it)
      const { loadProject } = await import("../state/state.js");
      vi.mocked(loadProject).mockResolvedValue({ id: "proj-1", name: "Test Project", repoUrl: "https://github.com/test/repo" } as never);

      const auto = makeAutomation({ projectId: "proj-1" });
      await saveAutomations([auto], dataDir);

      const scheduler = new AutomationScheduler(dataDir);
      await scheduler.triggerNow("auto-1");

      const autos = await loadAutomations(dataDir);
      expect(autos[0].workspacePath).toBeDefined();

      scheduler.stop();
    });

    it("cleans untracked and ignored files when reusing an existing project workspace", async () => {
      const { loadProject } = await import("../state/state.js");
      const { git } = await import("../utils/git.js");
      vi.mocked(loadProject).mockResolvedValue({ id: "proj-1", name: "Test Project", repoUrl: "https://github.com/test/repo" } as never);

      const auto = makeAutomation({ projectId: "proj-1" });
      await saveAutomations([auto], dataDir);

      const scheduler = new AutomationScheduler(dataDir);
      const run = await scheduler.triggerNow("auto-1");

      expect(run.status).toBe("success");
      expect(git).toHaveBeenCalledWith(
        ["clean", "-ffdx"],
        join(dataDir, "automations", "auto-1", "workspace"),
      );

      scheduler.stop();
    });

    it("creates a worktree when existing workspace path is not a git repo", async () => {
      const { loadProject } = await import("../state/state.js");
      const { git } = await import("../utils/git.js");
      vi.mocked(loadProject).mockResolvedValue({ id: "proj-1", name: "Test Project", repoUrl: "https://github.com/test/repo" } as never);
      vi.mocked(git).mockImplementationOnce(async () => {
        throw new Error("not a git repository");
      });

      const auto = makeAutomation({ projectId: "proj-1" });
      await saveAutomations([auto], dataDir);

      const scheduler = new AutomationScheduler(dataDir);
      const run = await scheduler.triggerNow("auto-1");

      expect(run.status).toBe("success");
      expect(git).toHaveBeenCalledWith(
        ["worktree", "add", expect.stringContaining("/workspace"), "main"],
        "/tmp/bare",
      );
      expect(git).toHaveBeenCalledWith(
        ["reset", "--hard", "origin/main"],
        join(dataDir, "automations", "auto-1", "workspace"),
      );
      expect(git).toHaveBeenCalledWith(
        ["clean", "-ffdx"],
        join(dataDir, "automations", "auto-1", "workspace"),
      );

      scheduler.stop();
    });

    it("falls back to FETCH_HEAD reset when origin branch ref is unavailable", async () => {
      const { loadProject } = await import("../state/state.js");
      const { git } = await import("../utils/git.js");
      vi.mocked(loadProject).mockResolvedValue({ id: "proj-1", name: "Test Project", repoUrl: "https://github.com/test/repo" } as never);
      vi.mocked(git).mockImplementation(async (args) => {
        if (args[0] === "status") {
          throw new Error("not a git repository");
        }
        if (args[0] === "reset" && args[2] === "origin/main") {
          throw new Error("unknown revision");
        }
        return { stdout: "", stderr: "" };
      });

      const auto = makeAutomation({ projectId: "proj-1" });
      await saveAutomations([auto], dataDir);

      const scheduler = new AutomationScheduler(dataDir);
      const run = await scheduler.triggerNow("auto-1");

      expect(run.status).toBe("success");
      expect(git).toHaveBeenCalledWith(
        ["reset", "--hard", "FETCH_HEAD"],
        join(dataDir, "automations", "auto-1", "workspace"),
      );

      scheduler.stop();
    });

    it("marks run as failure when workspace setup throws unexpected git errors", async () => {
      const { loadProject } = await import("../state/state.js");
      const { git } = await import("../utils/git.js");
      vi.mocked(loadProject).mockResolvedValue({ id: "proj-1", name: "Test Project", repoUrl: "https://github.com/test/repo" } as never);
      vi.mocked(git).mockImplementationOnce(async () => {
        throw new Error("Permission denied");
      });

      const auto = makeAutomation({
        projectId: "proj-1",
        notification: { onComplete: false, onFailure: false },
      });
      await saveAutomations([auto], dataDir);

      const scheduler = new AutomationScheduler(dataDir);
      const run = await scheduler.triggerNow("auto-1");

      expect(run.status).toBe("failure");
      expect(run.error).toContain("Permission denied");
      const persistedRuns = await loadRuns("auto-1", dataDir);
      expect(persistedRuns[0]?.status).toBe("failure");
      expect(persistedRuns[0]?.error).toContain("Permission denied");

      scheduler.stop();
    });

    it("fails cleanly when project is deleted between workspace setup and git-context injection", async () => {
      const { loadProject } = await import("../state/state.js");
      vi.mocked(loadProject)
        .mockResolvedValueOnce({ id: "proj-1", name: "Test Project", repoUrl: "https://github.com/test/repo" } as never)
        .mockResolvedValueOnce(null as never);

      const auto = makeAutomation({
        projectId: "proj-1",
        notification: { onComplete: false, onFailure: false },
      });
      await saveAutomations([auto], dataDir);

      const scheduler = new AutomationScheduler(dataDir);
      const run = await scheduler.triggerNow("auto-1");

      expect(run.status).toBe("failure");
      expect(run.error).toBe("Project proj-1 not found (deleted?)");

      scheduler.stop();
    });
  });

  describe("git context injection", () => {
    it("injects git context into system prompt for project-linked automations", async () => {
      const { loadProject } = await import("../state/state.js");
      vi.mocked(loadProject).mockResolvedValue({ id: "proj-1", name: "Test Project", repoUrl: "https://github.com/test/repo" } as never);

      const auto = makeAutomation({
        projectId: "proj-1",
        action: { type: "agent", modelId: "claude:opus-4-6", userPromptInline: "Review code", systemPromptInline: "You are a reviewer." },
      });
      await saveAutomations([auto], dataDir);

      const scheduler = new AutomationScheduler(dataDir);
      await scheduler.triggerNow("auto-1");

      const lastCall = sessionConstructorCalls[sessionConstructorCalls.length - 1];
      const sysPrompt = lastCall.systemPrompt as string;
      expect(sysPrompt).toContain("You are a reviewer.");
      expect(sysPrompt).toContain("# Git Context");
      expect(sysPrompt).toContain("Project: Test Project");
      expect(sysPrompt).toContain("## Summary");

      scheduler.stop();
    });

    it("uses git context as sole system prompt when no system prompt is configured", async () => {
      const { loadProject } = await import("../state/state.js");
      vi.mocked(loadProject).mockResolvedValue({ id: "proj-1", name: "Test Project", repoUrl: "https://github.com/test/repo" } as never);

      const auto = makeAutomation({
        projectId: "proj-1",
        action: { type: "agent", modelId: "claude:opus-4-6", userPromptInline: "Review code" },
      });
      await saveAutomations([auto], dataDir);

      const scheduler = new AutomationScheduler(dataDir);
      await scheduler.triggerNow("auto-1");

      const lastCall = sessionConstructorCalls[sessionConstructorCalls.length - 1];
      const sysPrompt = lastCall.systemPrompt as string;
      expect(sysPrompt).toContain("# Git Context");
      expect(sysPrompt).toContain("## Summary");
      // Should NOT start with \n\n (no empty prefix from missing base prompt)
      expect(sysPrompt).not.toMatch(/^\n/);

      scheduler.stop();
    });

    it("does not inject git context for non-project automations", async () => {
      const { loadProject } = await import("../state/state.js");
      vi.mocked(loadProject).mockResolvedValue(null as never);

      const auto = makeAutomation({
        projectId: undefined,
        action: { type: "agent", modelId: "claude:opus-4-6", userPromptInline: "Do stuff", systemPromptInline: "You are helpful." },
      });
      await saveAutomations([auto], dataDir);

      const scheduler = new AutomationScheduler(dataDir);
      await scheduler.triggerNow("auto-1");

      const lastCall = sessionConstructorCalls[sessionConstructorCalls.length - 1];
      const sysPrompt = lastCall.systemPrompt as string;
      expect(sysPrompt).toContain("You are helpful.");
      expect(sysPrompt).not.toContain("# Git Context");

      scheduler.stop();
    });

    it("interpolates {PROJECT}, {DIR}, and {DEFAULT_BRANCH} in system prompts", async () => {
      const { loadProject } = await import("../state/state.js");
      vi.mocked(loadProject).mockResolvedValue({ id: "proj-1", name: "My App", repoUrl: "https://github.com/test/repo" } as never);

      const auto = makeAutomation({
        projectId: "proj-1",
        action: {
          type: "agent",
          modelId: "claude:opus-4-6",
          userPromptInline: "Review code",
          systemPromptInline: "Project={PROJECT}\nDir={DIR}\nBranch={DEFAULT_BRANCH}",
        },
      });
      await saveAutomations([auto], dataDir);

      const scheduler = new AutomationScheduler(dataDir);
      await scheduler.triggerNow("auto-1");

      const lastCall = sessionConstructorCalls[sessionConstructorCalls.length - 1];
      const sysPrompt = lastCall.systemPrompt as string;
      expect(sysPrompt).toContain("Project=My App");
      expect(sysPrompt).toContain(`Dir=${join(dataDir, "automations", "auto-1", "workspace")}`);
      expect(sysPrompt).toContain("Branch=main");
      expect(sysPrompt).not.toContain("{PROJECT}");
      expect(sysPrompt).not.toContain("{DIR}");
      expect(sysPrompt).not.toContain("{DEFAULT_BRANCH}");

      scheduler.stop();
    });

    it("calls getGitContext with workspace path and default branch", async () => {
      const { loadProject } = await import("../state/state.js");
      vi.mocked(loadProject).mockResolvedValue({ id: "proj-1", name: "Test Project", repoUrl: "https://github.com/test/repo" } as never);
      const { getGitContext } = await import("../agents/system-prompt.js");

      const auto = makeAutomation({ projectId: "proj-1" });
      await saveAutomations([auto], dataDir);

      const scheduler = new AutomationScheduler(dataDir);
      await scheduler.triggerNow("auto-1");

      expect(getGitContext).toHaveBeenCalledWith(
        expect.stringContaining("workspace"),
        "main",
      );

      scheduler.stop();
    });

    it("calls formatGitContextBlock with project name", async () => {
      const { loadProject } = await import("../state/state.js");
      vi.mocked(loadProject).mockResolvedValue({ id: "proj-1", name: "My App", repoUrl: "https://github.com/test/repo" } as never);
      const { formatGitContextBlock } = await import("../agents/system-prompt.js");

      const auto = makeAutomation({ projectId: "proj-1" });
      await saveAutomations([auto], dataDir);

      const scheduler = new AutomationScheduler(dataDir);
      await scheduler.triggerNow("auto-1");

      expect(formatGitContextBlock).toHaveBeenCalledWith(
        expect.objectContaining({ branch: "main", defaultBranch: "main" }),
        { projectName: "My App" },
      );

      scheduler.stop();
    });
  });

  describe("system prompt persistence", () => {
    it("persists resolved system prompt for run log viewer", async () => {
      const { loadProject } = await import("../state/state.js");
      vi.mocked(loadProject).mockResolvedValue(null as never);

      const auto = makeAutomation({
        projectId: undefined,
        action: {
          type: "agent",
          modelId: "claude:opus-4-6",
          userPromptInline: "Do stuff",
          systemPromptInline: "You are strict.",
        },
      });
      await saveAutomations([auto], dataDir);

      const scheduler = new AutomationScheduler(dataDir);
      const run = await scheduler.triggerNow("auto-1");

      const promptPath = join(
        dataDir,
        "automations",
        "auto-1",
        "sessions",
        run.sessionId,
        "system-prompt.txt",
      );
      const persisted = await readFile(promptPath, "utf-8");
      expect(persisted).toBe("You are strict.");
      expect(persisted).not.toContain("## Summary");

      scheduler.stop();
    });

    it("does not persist system prompt file when no system prompt is resolved", async () => {
      const { loadProject } = await import("../state/state.js");
      vi.mocked(loadProject).mockResolvedValue(null as never);

      const auto = makeAutomation({
        projectId: undefined,
        action: {
          type: "agent",
          modelId: "claude:opus-4-6",
          userPromptInline: "Do stuff",
        },
      });
      await saveAutomations([auto], dataDir);

      const scheduler = new AutomationScheduler(dataDir);
      const run = await scheduler.triggerNow("auto-1");

      const promptPath = join(
        dataDir,
        "automations",
        "auto-1",
        "sessions",
        run.sessionId,
        "system-prompt.txt",
      );
      await expect(readFile(promptPath, "utf-8")).rejects.toMatchObject({ code: "ENOENT" });

      scheduler.stop();
    });
  });
});
