import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "../utils/test-helpers.js";
import {
  loadGitHubPollState,
  saveGitHubPollState,
  withPollStateLock,
  pruneProcessedEvents,
  pruneStaleSnapshots,
  _clearPollLocksForTests,
} from "./github-poll-state.js";
import type {
  GitHubPollState,
  PrSnapshot,
  IssueSnapshot,
  RepoPollingState,
} from "./github-poll-state.js";

let dataDir: string;

function makeRepoState(overrides: Partial<RepoPollingState> = {}): RepoPollingState {
  return {
    lastPollAt: "2026-01-01T00:00:00Z",
    prSnapshots: {},
    issueSnapshots: {},
    processedEvents: [],
    ...overrides,
  };
}

function makePrSnapshot(overrides: Partial<PrSnapshot> = {}): PrSnapshot {
  return {
    number: 1,
    headSha: "abc123",
    state: "open",
    commentCount: 0,
    updatedAt: "2026-01-01T00:00:00Z",
    labels: [],
    ...overrides,
  };
}

function makeIssueSnapshot(overrides: Partial<IssueSnapshot> = {}): IssueSnapshot {
  return {
    number: 1,
    state: "open",
    commentCount: 0,
    updatedAt: "2026-01-01T00:00:00Z",
    labels: [],
    ...overrides,
  };
}

beforeEach(async () => {
  _clearPollLocksForTests();
  const tmp = await createTempDir();
  dataDir = join(tmp, "data");
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

describe("loadGitHubPollState", () => {
  it("returns empty state when file does not exist", async () => {
    const state = await loadGitHubPollState(dataDir);
    expect(state).toEqual({ repos: {} });
  });

  it("returns parsed state from disk", async () => {
    const original: GitHubPollState = {
      repos: {
        "owner/repo": makeRepoState({
          prSnapshots: { 1: makePrSnapshot() },
        }),
      },
    };
    await saveGitHubPollState(original, dataDir);
    const loaded = await loadGitHubPollState(dataDir);
    expect(loaded).toEqual(original);
  });
});

describe("saveGitHubPollState", () => {
  it("save and load roundtrip preserves data", async () => {
    const state: GitHubPollState = {
      repos: {
        "org/alpha": makeRepoState({
          prSnapshots: {
            10: makePrSnapshot({ number: 10, headSha: "sha10", labels: ["bug"] }),
            20: makePrSnapshot({ number: 20, state: "closed" }),
          },
          issueSnapshots: {
            5: makeIssueSnapshot({ number: 5, commentCount: 3 }),
          },
          processedEvents: ["fp-1", "fp-2"],
        }),
        "org/beta": makeRepoState(),
      },
    };
    await saveGitHubPollState(state, dataDir);
    const loaded = await loadGitHubPollState(dataDir);
    expect(loaded).toEqual(state);
    expect(loaded.repos["org/alpha"].prSnapshots[10].labels).toEqual(["bug"]);
    expect(loaded.repos["org/alpha"].processedEvents).toHaveLength(2);
    expect(Object.keys(loaded.repos)).toHaveLength(2);
  });

  it("overwrites on save", async () => {
    await saveGitHubPollState({ repos: { "a/b": makeRepoState() } }, dataDir);
    await saveGitHubPollState({ repos: { "c/d": makeRepoState() } }, dataDir);
    const loaded = await loadGitHubPollState(dataDir);
    expect(Object.keys(loaded.repos)).toEqual(["c/d"]);
  });
});

describe("withPollStateLock", () => {
  it("serializes concurrent operations", async () => {
    const order: number[] = [];
    const state: GitHubPollState = { repos: {} };
    await saveGitHubPollState(state, dataDir);

    const p1 = withPollStateLock(async () => {
      const s = await loadGitHubPollState(dataDir);
      // Simulate delay
      await new Promise((r) => setTimeout(r, 50));
      s.repos["first/repo"] = makeRepoState();
      await saveGitHubPollState(s, dataDir);
      order.push(1);
    });

    const p2 = withPollStateLock(async () => {
      const s = await loadGitHubPollState(dataDir);
      s.repos["second/repo"] = makeRepoState();
      await saveGitHubPollState(s, dataDir);
      order.push(2);
    });

    await Promise.all([p1, p2]);

    // Operations should have serialized: 1 before 2
    expect(order).toEqual([1, 2]);

    // Both writes should be present (no lost update)
    const loaded = await loadGitHubPollState(dataDir);
    expect(Object.keys(loaded.repos)).toContain("first/repo");
    expect(Object.keys(loaded.repos)).toContain("second/repo");
  });
});

describe("pruneProcessedEvents", () => {
  it("caps processedEvents at 500, keeping newest", () => {
    const events: string[] = [];
    for (let i = 0; i < 600; i++) {
      events.push(`fp-${i}`);
    }
    const state: GitHubPollState = {
      repos: {
        "owner/repo": makeRepoState({ processedEvents: events }),
      },
    };

    pruneProcessedEvents(state);

    const pruned = state.repos["owner/repo"].processedEvents;
    expect(pruned).toHaveLength(500);
    // Should keep the newest (last 500), so first should be fp-100
    expect(pruned[0]).toBe("fp-100");
    expect(pruned[pruned.length - 1]).toBe("fp-599");
  });

  it("does not alter events under the cap", () => {
    const events = ["fp-1", "fp-2", "fp-3"];
    const state: GitHubPollState = {
      repos: {
        "owner/repo": makeRepoState({ processedEvents: events }),
      },
    };

    pruneProcessedEvents(state);
    expect(state.repos["owner/repo"].processedEvents).toEqual(["fp-1", "fp-2", "fp-3"]);
  });

  it("prunes each repo independently", () => {
    const bigEvents: string[] = [];
    for (let i = 0; i < 510; i++) bigEvents.push(`e-${i}`);
    const smallEvents = ["a", "b"];

    const state: GitHubPollState = {
      repos: {
        "org/big": makeRepoState({ processedEvents: [...bigEvents] }),
        "org/small": makeRepoState({ processedEvents: [...smallEvents] }),
      },
    };

    pruneProcessedEvents(state);
    expect(state.repos["org/big"].processedEvents).toHaveLength(500);
    expect(state.repos["org/small"].processedEvents).toEqual(["a", "b"]);
  });
});

describe("pruneStaleSnapshots", () => {
  const oldDate = "2020-01-01T00:00:00Z"; // well over 30 days ago
  const recentDate = new Date().toISOString(); // now

  it("removes closed PRs older than 30 days", () => {
    const state: GitHubPollState = {
      repos: {
        "owner/repo": makeRepoState({
          prSnapshots: {
            1: makePrSnapshot({ number: 1, state: "closed", updatedAt: oldDate }),
            2: makePrSnapshot({ number: 2, state: "open", updatedAt: oldDate }),
            3: makePrSnapshot({ number: 3, state: "merged", updatedAt: oldDate }),
            4: makePrSnapshot({ number: 4, state: "closed", updatedAt: recentDate }),
          },
        }),
      },
    };

    pruneStaleSnapshots(state);
    const prs = state.repos["owner/repo"].prSnapshots;

    // #1 closed+old -> removed
    expect(prs[1]).toBeUndefined();
    // #2 open+old -> kept (only closed/merged are pruned)
    expect(prs[2]).toBeDefined();
    // #3 merged+old -> removed
    expect(prs[3]).toBeUndefined();
    // #4 closed+recent -> kept
    expect(prs[4]).toBeDefined();
  });

  it("removes closed issues older than 30 days", () => {
    const state: GitHubPollState = {
      repos: {
        "owner/repo": makeRepoState({
          issueSnapshots: {
            10: makeIssueSnapshot({ number: 10, state: "closed", updatedAt: oldDate }),
            11: makeIssueSnapshot({ number: 11, state: "open", updatedAt: oldDate }),
            12: makeIssueSnapshot({ number: 12, state: "closed", updatedAt: recentDate }),
          },
        }),
      },
    };

    pruneStaleSnapshots(state);
    const issues = state.repos["owner/repo"].issueSnapshots;

    // #10 closed+old -> removed
    expect(issues[10]).toBeUndefined();
    // #11 open+old -> kept
    expect(issues[11]).toBeDefined();
    // #12 closed+recent -> kept
    expect(issues[12]).toBeDefined();
  });

  it("does not touch open items regardless of age", () => {
    const state: GitHubPollState = {
      repos: {
        "owner/repo": makeRepoState({
          prSnapshots: {
            1: makePrSnapshot({ number: 1, state: "open", updatedAt: oldDate }),
          },
          issueSnapshots: {
            2: makeIssueSnapshot({ number: 2, state: "open", updatedAt: oldDate }),
          },
        }),
      },
    };

    pruneStaleSnapshots(state);
    expect(state.repos["owner/repo"].prSnapshots[1]).toBeDefined();
    expect(state.repos["owner/repo"].issueSnapshots[2]).toBeDefined();
  });
});
