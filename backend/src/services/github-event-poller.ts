import { loadAutomations } from "../state/automations.js";
import { loadProject } from "../state/state.js";
import {
  loadGitHubPollState,
  saveGitHubPollState,
  pruneProcessedEvents,
  pruneStaleSnapshots,
  pruneStaleRepos,
  withPollStateLock,
  type GitHubPollState,
  type RepoPollingState,
} from "../state/github-poll-state.js";
import { gh, parseGitHubRepo, isGhInstalled } from "../utils/github.js";
import type { GitHubEventContext } from "../agents/github-prompt-context.js";
import type { AutomationScheduler } from "./automation-scheduler.js";
import type { Automation, GitHubEventType, GitHubTriggerEvent } from "../types.js";

const DEFAULT_POLL_INTERVAL_MS = 60_000;
const GH_AUTH_BACKOFF_MS = 5 * 60_000; // 5 min backoff on auth errors

interface DetectedEvent {
  repo: string; // "owner/repo"
  event: GitHubTriggerEvent;
  fingerprint: string;
}

export class GitHubEventPoller {
  private readonly dataDir: string;
  private readonly scheduler: AutomationScheduler;
  private interval: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private ghBackoffUntil = 0;

  constructor(dataDir: string, scheduler: AutomationScheduler) {
    this.dataDir = dataDir;
    this.scheduler = scheduler;
  }

  async start(intervalMs = DEFAULT_POLL_INTERVAL_MS): Promise<void> {
    this.stop();
    // Initial poll
    await this.poll().catch((err) =>
      console.error("[github-poller] Initial poll error:", err),
    );
    this.interval = setInterval(() => {
      void this.poll().catch((err) =>
        console.error("[github-poller] Poll error:", err),
      );
    }, intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;

    try {
      // Backoff check
      if (Date.now() < this.ghBackoffUntil) return;

      // Check gh availability
      if (!(await isGhInstalled())) return;

      // Load github_event automations
      const automations = await loadAutomations(this.dataDir);
      const ghAutomations = automations.filter(
        (a) => a.enabled && a.trigger.type === "github_event" && a.projectId,
      );
      if (ghAutomations.length === 0) return;

      // Group by repo
      const repoToAutos = new Map<string, Automation[]>();
      for (const auto of ghAutomations) {
        const project = await loadProject(auto.projectId!, this.dataDir);
        if (!project) continue;
        const ghRepo = parseGitHubRepo(project.url);
        if (!ghRepo) continue;
        const key = `${ghRepo.owner}/${ghRepo.repo}`;
        const list = repoToAutos.get(key) ?? [];
        list.push(auto);
        repoToAutos.set(key, list);
      }

      // Load, poll, and save state under lock
      await withPollStateLock(async () => {
        const state = await loadGitHubPollState(this.dataDir);

        // Poll each repo
        for (const [repoKey, autos] of repoToAutos) {
          try {
            await this.pollRepo(repoKey, autos, state);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (
              msg.includes("auth login") ||
              msg.includes("401") ||
              msg.includes("403")
            ) {
              console.warn(
                `[github-poller] Auth error for ${repoKey}, backing off`,
              );
              this.ghBackoffUntil = Date.now() + GH_AUTH_BACKOFF_MS;
              break;
            }
            console.error(`[github-poller] Error polling ${repoKey}:`, err);
          }
        }

        // Prune and save state
        pruneStaleRepos(state, new Set(repoToAutos.keys()));
        pruneProcessedEvents(state);
        pruneStaleSnapshots(state);
        await saveGitHubPollState(state, this.dataDir);
      });
    } finally {
      this.polling = false;
    }
  }

  private async pollRepo(
    repoKey: string,
    automations: Automation[],
    state: GitHubPollState,
  ): Promise<void> {
    const [owner, repo] = repoKey.split("/");

    // Initialize repo state if needed
    if (!state.repos[repoKey]) {
      state.repos[repoKey] = {
        lastPollAt: new Date().toISOString(),
        prSnapshots: {},
        issueSnapshots: {},
        processedEvents: [],
      };
      // First poll: take snapshots only, don't trigger events
      await this.takeSnapshots(owner, repo, state.repos[repoKey]);
      return;
    }

    const repoState = state.repos[repoKey];

    // Determine which event types we need
    const neededEvents = new Set<GitHubEventType>();
    for (const auto of automations) {
      if (auto.trigger.type === "github_event") {
        for (const evt of auto.trigger.events) {
          neededEvents.add(evt);
        }
      }
    }

    const needsPrs = [...neededEvents].some((e) =>
      e.startsWith("pull_request."),
    );
    const needsIssues = [...neededEvents].some((e) => e.startsWith("issues."));

    // Fetch current state from GitHub
    const detectedEvents: DetectedEvent[] = [];

    if (needsPrs) {
      const prs = await this.fetchPrs(owner, repo);
      for (const pr of prs) {
        const old = repoState.prSnapshots[pr.number];

        if (!old) {
          // New PR
          detectedEvents.push({
            repo: repoKey,
            event: {
              type: "pull_request.opened",
              number: pr.number,
              title: pr.title,
              url: pr.url,
              headSha: pr.headSha,
              actor: pr.author,
            },
            fingerprint: `${repoKey}:pull_request.opened:${pr.number}:${pr.headSha}`,
          });
        } else {
          // Check for synchronize (head SHA changed)
          if (pr.headSha !== old.headSha) {
            detectedEvents.push({
              repo: repoKey,
              event: {
                type: "pull_request.synchronize",
                number: pr.number,
                title: pr.title,
                url: pr.url,
                headSha: pr.headSha,
                actor: pr.author,
              },
              fingerprint: `${repoKey}:pull_request.synchronize:${pr.number}:${pr.headSha}`,
            });
          }
          // Check for new comments
          if (pr.commentCount > old.commentCount) {
            detectedEvents.push({
              repo: repoKey,
              event: {
                type: "pull_request.comment",
                number: pr.number,
                title: pr.title,
                url: pr.url,
                headSha: pr.headSha,
                actor: pr.author,
              },
              fingerprint: `${repoKey}:pull_request.comment:${pr.number}:${pr.commentCount}`,
            });
          }
          // Check for reopened
          if (old.state === "CLOSED" && pr.state === "OPEN") {
            detectedEvents.push({
              repo: repoKey,
              event: {
                type: "pull_request.reopened",
                number: pr.number,
                title: pr.title,
                url: pr.url,
                headSha: pr.headSha,
                actor: pr.author,
              },
              fingerprint: `${repoKey}:pull_request.reopened:${pr.number}:${pr.updatedAt}`,
            });
          }
        }

        // Update snapshot
        repoState.prSnapshots[pr.number] = {
          number: pr.number,
          headSha: pr.headSha,
          state: pr.state,
          commentCount: pr.commentCount,
          updatedAt: pr.updatedAt,
          labels: pr.labels,
        };
      }
    }

    if (needsIssues) {
      const issues = await this.fetchIssues(owner, repo);
      for (const issue of issues) {
        const old = repoState.issueSnapshots[issue.number];

        if (!old) {
          detectedEvents.push({
            repo: repoKey,
            event: {
              type: "issues.opened",
              number: issue.number,
              title: issue.title,
              url: issue.url,
            },
            fingerprint: `${repoKey}:issues.opened:${issue.number}:new`,
          });
        } else {
          if (issue.commentCount > old.commentCount) {
            detectedEvents.push({
              repo: repoKey,
              event: {
                type: "issues.comment",
                number: issue.number,
                title: issue.title,
                url: issue.url,
              },
              fingerprint: `${repoKey}:issues.comment:${issue.number}:${issue.commentCount}`,
            });
          }
        }

        repoState.issueSnapshots[issue.number] = {
          number: issue.number,
          state: issue.state,
          commentCount: issue.commentCount,
          updatedAt: issue.updatedAt,
          labels: issue.labels,
        };
      }
    }

    repoState.lastPollAt = new Date().toISOString();

    // Deduplicate and dispatch events
    for (const detected of detectedEvents) {
      if (repoState.processedEvents.includes(detected.fingerprint)) continue;
      repoState.processedEvents.push(detected.fingerprint);

      // Match against automations
      for (const auto of automations) {
        if (auto.trigger.type !== "github_event") continue;
        if (!auto.trigger.events.includes(detected.event.type)) continue;

        // Label filter
        if (auto.trigger.labelFilter?.length) {
          const itemLabels = detected.event.type.startsWith("pull_request.")
            ? (repoState.prSnapshots[detected.event.number]?.labels ?? [])
            : (repoState.issueSnapshots[detected.event.number]?.labels ?? []);
          const hasMatchingLabel = auto.trigger.labelFilter.some((l) =>
            itemLabels.includes(l),
          );
          if (!hasMatchingLabel) continue;
        }

        // Skip if already running
        if (this.scheduler.isRunning(auto.id)) {
          console.log(
            `[github-poller] Skipping ${auto.id}: already running`,
          );
          continue;
        }

        // Enrich context and dispatch
        try {
          const context = await this.enrichEventContext(
            owner,
            repo,
            detected.event,
          );
          void this.scheduler
            .executeEventRun(auto.id, detected.event, context)
            .catch((err: unknown) => {
              console.error(
                `[github-poller] Error executing run for ${auto.id}:`,
                err,
              );
            });
        } catch (err) {
          console.error(
            `[github-poller] Error enriching context for ${auto.id}:`,
            err,
          );
        }
      }
    }
  }

  private async takeSnapshots(
    owner: string,
    repo: string,
    repoState: RepoPollingState,
  ): Promise<void> {
    const prs = await this.fetchPrs(owner, repo);
    for (const pr of prs) {
      repoState.prSnapshots[pr.number] = {
        number: pr.number,
        headSha: pr.headSha,
        state: pr.state,
        commentCount: pr.commentCount,
        updatedAt: pr.updatedAt,
        labels: pr.labels,
      };
    }

    const issues = await this.fetchIssues(owner, repo);
    for (const issue of issues) {
      repoState.issueSnapshots[issue.number] = {
        number: issue.number,
        state: issue.state,
        commentCount: issue.commentCount,
        updatedAt: issue.updatedAt,
        labels: issue.labels,
      };
    }
  }

  private async fetchPrs(
    owner: string,
    repo: string,
  ): Promise<
    Array<{
      number: number;
      title: string;
      url: string;
      headSha: string;
      state: string;
      commentCount: number;
      updatedAt: string;
      labels: string[];
      author: string;
    }>
  > {
    try {
      const { stdout } = await gh([
        "pr",
        "list",
        "--repo",
        `${owner}/${repo}`,
        "--state",
        "all",
        "--json",
        "number,url,title,headRefOid,state,labels,updatedAt,author,comments",
        "--limit",
        "30",
      ]);
      const items = JSON.parse(stdout) as Array<{
        number: number;
        url: string;
        title: string;
        headRefOid: string;
        state: string;
        labels: Array<{ name: string }>;
        updatedAt: string;
        author: { login: string };
        comments: Array<unknown>;
      }>;
      return items.map((item) => ({
        number: item.number,
        title: item.title,
        url: item.url,
        headSha: item.headRefOid,
        state: item.state,
        commentCount: item.comments?.length ?? 0,
        updatedAt: item.updatedAt,
        labels: item.labels?.map((l) => l.name) ?? [],
        author: item.author?.login ?? "",
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("auth login") || msg.includes("401") || msg.includes("403")) {
        throw err;
      }
      return [];
    }
  }

  private async fetchIssues(
    owner: string,
    repo: string,
  ): Promise<
    Array<{
      number: number;
      title: string;
      url: string;
      state: string;
      commentCount: number;
      updatedAt: string;
      labels: string[];
    }>
  > {
    try {
      const { stdout } = await gh([
        "issue",
        "list",
        "--repo",
        `${owner}/${repo}`,
        "--state",
        "all",
        "--json",
        "number,url,title,state,labels,updatedAt,comments",
        "--limit",
        "30",
      ]);
      const items = JSON.parse(stdout) as Array<{
        number: number;
        url: string;
        title: string;
        state: string;
        labels: Array<{ name: string }>;
        updatedAt: string;
        comments: Array<unknown>;
      }>;
      return items.map((item) => ({
        number: item.number,
        title: item.title,
        url: item.url,
        state: item.state,
        commentCount: item.comments?.length ?? 0,
        updatedAt: item.updatedAt,
        labels: item.labels?.map((l) => l.name) ?? [],
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("auth login") || msg.includes("401") || msg.includes("403")) {
        throw err;
      }
      return [];
    }
  }

  private async enrichEventContext(
    owner: string,
    repo: string,
    event: GitHubTriggerEvent,
  ): Promise<GitHubEventContext> {
    const ctx: GitHubEventContext = {
      headSha: event.headSha,
    };

    if (event.type.startsWith("pull_request.")) {
      ctx.prNumber = event.number;
      ctx.prTitle = event.title;
      ctx.prUrl = event.url;
      ctx.prAuthor = event.actor;

      // Fetch PR details (body + files)
      try {
        const { stdout: prJson } = await gh([
          "pr",
          "view",
          String(event.number),
          "--repo",
          `${owner}/${repo}`,
          "--json",
          "body,files",
        ]);
        const prDetail = JSON.parse(prJson) as {
          body?: string;
          files?: Array<{ path: string }>;
        };
        ctx.prBody = prDetail.body;
        ctx.prFiles = prDetail.files?.map((f) => f.path);
      } catch {
        // Non-critical
      }

      // Fetch diff
      try {
        const { stdout: diff } = await gh([
          "pr",
          "diff",
          String(event.number),
          "--repo",
          `${owner}/${repo}`,
        ]);
        ctx.prDiff = diff;
      } catch {
        // Non-critical
      }
    } else if (event.type.startsWith("issues.")) {
      ctx.issueNumber = event.number;
      ctx.issueTitle = event.title;
      ctx.issueUrl = event.url;

      try {
        const { stdout: issueJson } = await gh([
          "issue",
          "view",
          String(event.number),
          "--repo",
          `${owner}/${repo}`,
          "--json",
          "body",
        ]);
        const issueDetail = JSON.parse(issueJson) as { body?: string };
        ctx.issueBody = issueDetail.body;
      } catch {
        // Non-critical
      }
    }

    // Fetch latest comment if this is a comment event
    if (event.type.endsWith(".comment")) {
      try {
        const { stdout: commentsJson } = await gh([
          event.type.startsWith("pull_request.") ? "pr" : "issue",
          "view",
          String(event.number),
          "--repo",
          `${owner}/${repo}`,
          "--json",
          "comments",
        ]);
        const parsed = JSON.parse(commentsJson) as {
          comments?: Array<{ body: string; author: { login: string } }>;
        };
        const lastComment = parsed.comments?.[parsed.comments.length - 1];
        if (lastComment) {
          ctx.commentBody = lastComment.body;
          ctx.commentAuthor = lastComment.author?.login;
        }
      } catch {
        // Non-critical
      }
    }

    return ctx;
  }
}
