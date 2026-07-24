import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseGitHubRepo,
  fetchPrForBranch,
  isGhInstalled,
  gh,
  createGitHubRepository,
  fetchPrDetail,
  _resetGhState,
} from "./github.js";

// ── parseGitHubRepo ─────────────────────────────────────────────────

describe("parseGitHubRepo", () => {
  it("parses HTTPS URL", () => {
    expect(parseGitHubRepo("https://github.com/acme/widget")).toEqual({
      owner: "acme",
      repo: "widget",
    });
  });

  it("parses HTTPS URL with .git suffix", () => {
    expect(parseGitHubRepo("https://github.com/acme/widget.git")).toEqual({
      owner: "acme",
      repo: "widget",
    });
  });

  it("parses SCP-style SSH URL", () => {
    expect(parseGitHubRepo("git@github.com:acme/widget.git")).toEqual({
      owner: "acme",
      repo: "widget",
    });
  });

  it("parses SCP-style SSH URL without .git", () => {
    expect(parseGitHubRepo("git@github.com:acme/widget")).toEqual({
      owner: "acme",
      repo: "widget",
    });
  });

  it("parses ssh:// protocol URL", () => {
    expect(
      parseGitHubRepo("ssh://git@github.com/acme/widget.git"),
    ).toEqual({ owner: "acme", repo: "widget" });
  });

  it("returns null for non-GitHub HTTPS URL", () => {
    expect(parseGitHubRepo("https://gitlab.com/acme/widget")).toBeNull();
  });

  it("returns null for non-GitHub SCP URL", () => {
    expect(parseGitHubRepo("git@gitlab.com:acme/widget.git")).toBeNull();
  });

  it("returns null for URL with only owner (no repo)", () => {
    expect(parseGitHubRepo("https://github.com/acme")).toBeNull();
  });

  it("returns null for garbage string", () => {
    expect(parseGitHubRepo("not-a-url")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseGitHubRepo("")).toBeNull();
  });

  it("handles URL with trailing slash", () => {
    expect(parseGitHubRepo("https://github.com/acme/widget/")).toEqual({
      owner: "acme",
      repo: "widget",
    });
  });

  it("handles URL with extra path segments (e.g. /tree/main)", () => {
    // Should still extract owner/repo from first two segments
    const result = parseGitHubRepo("https://github.com/acme/widget/tree/main");
    expect(result).toEqual({ owner: "acme", repo: "widget" });
  });
});

// ── isGhInstalled ───────────────────────────────────────────────────

describe("isGhInstalled", () => {
  beforeEach(() => {
    _resetGhState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true when gh --version succeeds", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(mockExecFileSuccess("gh version 2.40.0"));

    const result = await isGhInstalled();
    expect(result).toBe(true);
  });

  it("returns false when gh --version throws ENOENT", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(mockExecFileError({ code: "ENOENT" }));

    const result = await isGhInstalled();
    expect(result).toBe(false);
  });

  it("returns true when gh --version throws a non-ENOENT error (binary exists but errored)", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(mockExecFileError({ code: "EPERM", message: "permission denied" }));

    const result = await isGhInstalled();
    expect(result).toBe(true);
  });

  it("caches the result across calls", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(mockExecFileSuccess("gh version 2.40.0"));

    await isGhInstalled();
    const callsAfterFirst = execFileMock.mock.calls.length;

    await isGhInstalled();

    // Second call should not invoke execFile again (cached)
    expect(execFileMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it("_resetGhState clears the cached result", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(mockExecFileError({ code: "ENOENT" }));

    expect(await isGhInstalled()).toBe(false);

    _resetGhState();

    execFileMock.mockImplementation(mockExecFileSuccess("gh version 2.40.0"));
    expect(await isGhInstalled()).toBe(true);
  });

  it("rechecks gh after ENOENT cooldown expires", async () => {
    const execFileMock = await getExecFileMock();
    let now = 100_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    execFileMock.mockImplementationOnce(mockExecFileError({ code: "ENOENT" }));

    expect(await isGhInstalled()).toBe(false);

    execFileMock.mockClear();
    expect(await isGhInstalled()).toBe(false);
    expect(execFileMock).not.toHaveBeenCalled();

    now += 60_001;
    execFileMock.mockImplementationOnce(mockExecFileSuccess("gh version 2.40.0"));
    expect(await isGhInstalled()).toBe(true);

    nowSpy.mockRestore();
  });
});

// ── gh() wrapper ────────────────────────────────────────────────────

describe("gh", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns trimmed stdout and stderr", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (...args: unknown[]) => void) => {
        cb(null, { stdout: "  hello\n  ", stderr: "  warn\n  " });
      },
    );

    const result = await gh(["some", "command"]);
    expect(result).toEqual({ stdout: "hello", stderr: "warn" });
  });

  it("throws when execFile errors", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(mockExecFileError({ message: "command failed" }));

    await expect(gh(["bad"])).rejects.toThrow("command failed");
  });
});

// ── createGitHubRepository ──────────────────────────────────────────

describe("createGitHubRepository", () => {
  function makeGhClient(handlers: { view?: () => Promise<{ stdout: string; stderr: string }> } = {}) {
    return vi.fn(async (args: string[]) => {
      const key = `${args[0]} ${args[1]}`;
      if (key === "api user") return { stdout: "octocat", stderr: "" };
      if (key === "repo create") return { stdout: "", stderr: "" };
      if (key === "repo view") {
        return handlers.view
          ? handlers.view()
          : { stdout: "https://github.com/octocat/my-repo", stderr: "" };
      }
      if (key === "repo delete") return { stdout: "", stderr: "" };
      throw new Error(`unexpected gh args: ${args.join(" ")}`);
    });
  }

  it("returns the repo and does not delete on success", async () => {
    const ghClient = makeGhClient();
    const repo = await createGitHubRepository("my-repo", "private", ghClient);
    expect(repo).toEqual({
      owner: "octocat",
      name: "my-repo",
      fullName: "octocat/my-repo",
      url: "https://github.com/octocat/my-repo",
    });
    expect(ghClient).toHaveBeenCalledWith([
      "repo",
      "view",
      "octocat/my-repo",
      "--json",
      "url",
      "--jq",
      ".url",
    ]);
    expect(ghClient.mock.calls.some((c) => c[0][0] === "repo" && c[0][1] === "delete")).toBe(false);
  });

  it("deletes the just-created repo when the HTTPS URL fetch fails (no orphan)", async () => {
    const ghClient = makeGhClient({ view: () => Promise.reject(new Error("replication lag")) });
    await expect(createGitHubRepository("my-repo", "private", ghClient)).rejects.toThrow();
    expect(ghClient).toHaveBeenCalledWith(["repo", "delete", "octocat/my-repo", "--yes"]);
  });

  it("rejects a non-HTTPS clone URL and deletes the new remote", async () => {
    const ghClient = makeGhClient({
      view: async () => ({
        stdout: "git@github.com:octocat/my-repo.git",
        stderr: "",
      }),
    });
    await expect(createGitHubRepository("my-repo", "private", ghClient)).rejects.toThrow(
      "HTTPS URL",
    );
    expect(ghClient).toHaveBeenCalledWith(["repo", "delete", "octocat/my-repo", "--yes"]);
  });
});

// ── fetchPrDetail ───────────────────────────────────────────────────

describe("fetchPrDetail", () => {
  it("requests and parses baseRefName alongside the other PR fields", async () => {
    const ghClient = vi.fn(async () => ({
      stdout: JSON.stringify({
        number: 12,
        title: "Fix streaming",
        url: "https://github.com/acme/demo/pull/12",
        headRefName: "feature-x",
        baseRefName: "develop",
        isCrossRepository: false,
      }),
      stderr: "",
    }));

    const detail = await fetchPrDetail("acme", "demo", 12, ghClient);

    expect(ghClient).toHaveBeenCalledWith(
      [
        "pr", "view", "12", "--repo", "acme/demo",
        "--json", "number,title,url,headRefName,baseRefName,isCrossRepository",
      ],
      expect.anything(),
    );
    expect(detail).toEqual({
      number: 12,
      title: "Fix streaming",
      url: "https://github.com/acme/demo/pull/12",
      headRefName: "feature-x",
      baseRefName: "develop",
      isCrossRepository: false,
    });
  });
});

// ── fetchPrForBranch ────────────────────────────────────────────────

// We mock child_process.execFile to avoid needing `gh` installed
vi.mock("node:child_process", () => {
  const execFile = vi.fn();
  return { execFile };
});

async function getExecFileMock() {
  const cp = await import("node:child_process");
  return cp.execFile as unknown as ReturnType<typeof vi.fn>;
}

function mockExecFileSuccess(stdout: string) {
  // Handle both 3-arg (promisify without opts) and 4-arg (promisify with opts) patterns
  return (...args: unknown[]) => {
    const cb = args[args.length - 1] as (...a: unknown[]) => void;
    cb(null, { stdout, stderr: "" });
  };
}

function mockExecFileError(error: { code?: string; stderr?: string; message?: string }) {
  return (...args: unknown[]) => {
    const cb = args[args.length - 1] as (...a: unknown[]) => void;
    const err = Object.assign(new Error(error.message ?? "fail"), {
      code: error.code,
      stderr: error.stderr,
    });
    cb(err);
  };
}

describe("fetchPrForBranch", () => {
  beforeEach(() => {
    _resetGhState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns PR info when gh returns a match", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(
      mockExecFileSuccess(
        JSON.stringify([
          {
            number: 42,
            url: "https://github.com/acme/widget/pull/42",
            state: "OPEN",
            isDraft: false,
            mergeable: "MERGEABLE",
            mergeStateStatus: "CLEAN",
            statusCheckRollup: [],
            reviewDecision: "",
          },
        ]),
      ),
    );

    const { pr, error } = await fetchPrForBranch("acme", "widget", "feature-x");

    expect(error).toBeUndefined();
    expect(pr).toEqual({
      number: 42,
      url: "https://github.com/acme/widget/pull/42",
      state: "open",
      mergeable: true,
      mergeableState: "clean",
      checksStatus: "success",
      checksPassed: null,
      checksTotal: null,
      reviewStatus: null,
    });
  });

  it("requests closed and merged PRs via --state all and includes reviewDecision field", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(mockExecFileSuccess("[]"));
    execFileMock.mockClear();

    await fetchPrForBranch("acme", "widget", "feature-x");

    expect(execFileMock).toHaveBeenCalled();
    const args = execFileMock.mock.calls.at(-1)?.[1] as string[];

    const stateIndex = args.indexOf("--state");
    expect(stateIndex).toBeGreaterThan(-1);
    expect(args[stateIndex + 1]).toBe("all");

    const jsonIndex = args.indexOf("--json");
    expect(jsonIndex).toBeGreaterThan(-1);
    expect(args[jsonIndex + 1]).toContain("reviewDecision");
  });

  it("returns null PR when gh returns empty array", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(mockExecFileSuccess("[]"));

    const { pr, error } = await fetchPrForBranch("acme", "widget", "no-pr-branch");

    expect(pr).toBeNull();
    expect(error).toBeUndefined();
  });

  it("maps draft PR state correctly", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(
      mockExecFileSuccess(
        JSON.stringify([
          {
            number: 10,
            url: "https://github.com/acme/widget/pull/10",
            state: "OPEN",
            isDraft: true,
            mergeable: "UNKNOWN",
            mergeStateStatus: "UNKNOWN",
            statusCheckRollup: [],
            reviewDecision: "",
          },
        ]),
      ),
    );

    const { pr } = await fetchPrForBranch("acme", "widget", "draft-branch");
    expect(pr!.state).toBe("draft");
  });

  it("maps merged PR state correctly", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(
      mockExecFileSuccess(
        JSON.stringify([
          {
            number: 11,
            url: "https://github.com/acme/widget/pull/11",
            state: "MERGED",
            isDraft: false,
            mergeable: "UNKNOWN",
            mergeStateStatus: "UNKNOWN",
            statusCheckRollup: [],
            reviewDecision: "",
          },
        ]),
      ),
    );

    const { pr } = await fetchPrForBranch("acme", "widget", "merged-branch");
    expect(pr!.state).toBe("merged");
  });

  it("maps closed PR state correctly", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(
      mockExecFileSuccess(
        JSON.stringify([
          {
            number: 12,
            url: "https://github.com/acme/widget/pull/12",
            state: "CLOSED",
            isDraft: false,
            mergeable: "UNKNOWN",
            mergeStateStatus: "UNKNOWN",
            statusCheckRollup: [],
            reviewDecision: "",
          },
        ]),
      ),
    );

    const { pr } = await fetchPrForBranch("acme", "widget", "closed-branch");
    expect(pr!.state).toBe("closed");
  });

  it("maps CONFLICTING mergeable to false", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(
      mockExecFileSuccess(
        JSON.stringify([
          {
            number: 13,
            url: "https://github.com/acme/widget/pull/13",
            state: "OPEN",
            isDraft: false,
            mergeable: "CONFLICTING",
            mergeStateStatus: "DIRTY",
            statusCheckRollup: [],
            reviewDecision: "",
          },
        ]),
      ),
    );

    const { pr } = await fetchPrForBranch("acme", "widget", "conflict-branch");
    expect(pr!.mergeable).toBe(false);
    expect(pr!.mergeableState).toBe("conflict");
  });

  it("maps BLOCKED mergeStateStatus to blocked", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(
      mockExecFileSuccess(
        JSON.stringify([
          {
            number: 14,
            url: "https://github.com/acme/widget/pull/14",
            state: "OPEN",
            isDraft: false,
            mergeable: "MERGEABLE",
            mergeStateStatus: "BLOCKED",
            statusCheckRollup: [],
            reviewDecision: "",
          },
        ]),
      ),
    );

    const { pr } = await fetchPrForBranch("acme", "widget", "blocked-branch");
    expect(pr!.mergeableState).toBe("blocked");
  });

  it("maps UNSTABLE mergeStateStatus correctly", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(
      mockExecFileSuccess(
        JSON.stringify([
          {
            number: 15,
            url: "https://github.com/acme/widget/pull/15",
            state: "OPEN",
            isDraft: false,
            mergeable: "MERGEABLE",
            mergeStateStatus: "UNSTABLE",
            statusCheckRollup: [{ conclusion: "FAILURE" }],
            reviewDecision: "",
          },
        ]),
      ),
    );

    const { pr } = await fetchPrForBranch("acme", "widget", "unstable-branch");
    expect(pr!.mergeableState).toBe("unstable");
    expect(pr!.checksStatus).toBe("failure");
  });

  it("maps UNKNOWN mergeStateStatus to unknown", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(
      mockExecFileSuccess(
        JSON.stringify([
          {
            number: 16,
            url: "https://github.com/acme/widget/pull/16",
            state: "OPEN",
            isDraft: false,
            mergeable: "UNKNOWN",
            mergeStateStatus: "UNKNOWN",
            statusCheckRollup: [],
            reviewDecision: "",
          },
        ]),
      ),
    );

    const { pr } = await fetchPrForBranch("acme", "widget", "unknown-branch");
    expect(pr!.mergeable).toBeNull();
    expect(pr!.mergeableState).toBe("unknown");
  });

  it("maps checksStatus to pending when check has no conclusion", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(
      mockExecFileSuccess(
        JSON.stringify([
          {
            number: 17,
            url: "https://github.com/acme/widget/pull/17",
            state: "OPEN",
            isDraft: false,
            mergeable: "MERGEABLE",
            mergeStateStatus: "CLEAN",
            statusCheckRollup: [{ state: "PENDING" }],
            reviewDecision: "",
          },
        ]),
      ),
    );

    const { pr } = await fetchPrForBranch("acme", "widget", "pending-checks");
    expect(pr!.checksStatus).toBe("pending");
  });

  it("maps checksStatus to pending when check has empty state and conclusion", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(
      mockExecFileSuccess(
        JSON.stringify([
          {
            number: 18,
            url: "https://github.com/acme/widget/pull/18",
            state: "OPEN",
            isDraft: false,
            mergeable: "MERGEABLE",
            mergeStateStatus: "CLEAN",
            statusCheckRollup: [{}],
            reviewDecision: "",
          },
        ]),
      ),
    );

    const { pr } = await fetchPrForBranch("acme", "widget", "empty-checks");
    expect(pr!.checksStatus).toBe("pending");
  });

  it("maps checksStatus to failure when any check failed by state", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(
      mockExecFileSuccess(
        JSON.stringify([
          {
            number: 19,
            url: "https://github.com/acme/widget/pull/19",
            state: "OPEN",
            isDraft: false,
            mergeable: "MERGEABLE",
            mergeStateStatus: "CLEAN",
            statusCheckRollup: [
              { conclusion: "SUCCESS" },
              { state: "FAILURE" },
            ],
            reviewDecision: "",
          },
        ]),
      ),
    );

    const { pr } = await fetchPrForBranch("acme", "widget", "state-fail");
    expect(pr!.checksStatus).toBe("failure");
  });

  // ── Error handling ──────────────────────────────────────────────────

  it("temporarily disables gh on ENOENT and retries after cooldown", async () => {
    const execFileMock = await getExecFileMock();
    let now = 100_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    execFileMock.mockImplementationOnce(mockExecFileError({ code: "ENOENT" }));

    const first = await fetchPrForBranch("acme", "widget", "branch-1");
    expect(first.pr).toBeNull();
    expect(first.error).toBe("gh CLI not installed");

    // Second call should skip gh entirely while in cooldown
    execFileMock.mockClear();
    const second = await fetchPrForBranch("acme", "widget", "branch-2");
    expect(second.pr).toBeNull();
    expect(second.error).toBe("gh CLI not installed");
    expect(execFileMock).not.toHaveBeenCalled();

    // After cooldown, gh should be tried again
    now += 60_001;
    execFileMock.mockImplementationOnce(mockExecFileSuccess("[]"));
    const third = await fetchPrForBranch("acme", "widget", "branch-3");
    expect(third.pr).toBeNull();
    expect(third.error).toBeUndefined();
    expect(execFileMock).toHaveBeenCalled();

    nowSpy.mockRestore();
  });

  it("returns auth error message when stderr contains 'auth login'", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(
      mockExecFileError({ stderr: "To get started with GitHub CLI, please run:  gh auth login" }),
    );

    const { pr, error } = await fetchPrForBranch("acme", "widget", "auth-branch");
    expect(pr).toBeNull();
    expect(error).toBe("gh not authenticated — run `gh auth login`");
  });

  it("returns generic error for other failures", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(
      mockExecFileError({ stderr: "API rate limit exceeded" }),
    );

    const { pr, error } = await fetchPrForBranch("acme", "widget", "rate-limited");
    expect(pr).toBeNull();
    expect(error).toContain("API rate limit exceeded");
  });

  it("pauses PR status refresh after a gh rate-limit error", async () => {
    const execFileMock = await getExecFileMock();
    let now = 100_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    execFileMock.mockImplementationOnce(
      mockExecFileError({ stderr: "API rate limit exceeded" }),
    );

    const first = await fetchPrForBranch("acme", "widget", "rate-limited");
    expect(first.error).toContain("API rate limit exceeded");

    execFileMock.mockClear();
    const second = await fetchPrForBranch("acme", "widget", "skipped");
    expect(second.pr).toBeNull();
    expect(second.error).toContain("GitHub rate limit reached");
    expect(execFileMock).not.toHaveBeenCalled();

    now += 5 * 60_000 + 1;
    execFileMock.mockImplementationOnce(mockExecFileSuccess("[]"));
    const third = await fetchPrForBranch("acme", "widget", "retry");
    expect(third.error).toBeUndefined();
    expect(execFileMock).toHaveBeenCalled();

    nowSpy.mockRestore();
  });

  it("keeps retrying after non-ENOENT errors (not permanently disabled)", async () => {
    const execFileMock = await getExecFileMock();

    // First call: generic error
    execFileMock.mockImplementation(
      mockExecFileError({ stderr: "transient error" }),
    );
    await fetchPrForBranch("acme", "widget", "retry-branch");

    // Second call: success
    execFileMock.mockImplementation(
      mockExecFileSuccess("[]"),
    );
    const { pr, error } = await fetchPrForBranch("acme", "widget", "retry-branch");
    expect(pr).toBeNull();
    expect(error).toBeUndefined();
  });

  it("checksStatus returns success when all checks have SUCCESS conclusion", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(
      mockExecFileSuccess(
        JSON.stringify([
          {
            number: 20,
            url: "https://github.com/acme/widget/pull/20",
            state: "OPEN",
            isDraft: false,
            mergeable: "MERGEABLE",
            mergeStateStatus: "CLEAN",
            statusCheckRollup: [
              { conclusion: "SUCCESS" },
              { conclusion: "SUCCESS" },
            ],
            reviewDecision: "",
          },
        ]),
      ),
    );

    const { pr } = await fetchPrForBranch("acme", "widget", "all-green");
    expect(pr!.checksStatus).toBe("success");
  });

  it("_resetGhState re-enables gh after ENOENT", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(mockExecFileError({ code: "ENOENT" }));

    await fetchPrForBranch("acme", "widget", "branch-a");

    _resetGhState();

    execFileMock.mockImplementation(mockExecFileSuccess("[]"));
    const { pr, error } = await fetchPrForBranch("acme", "widget", "branch-b");
    expect(pr).toBeNull();
    expect(error).toBeUndefined();
  });

  // ── Checks: cancelled status ──────────────────────────────────────

  it("maps checksStatus to cancelled when a check has CANCELLED conclusion", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(
      mockExecFileSuccess(
        JSON.stringify([
          {
            number: 30,
            url: "https://github.com/acme/widget/pull/30",
            state: "OPEN",
            isDraft: false,
            mergeable: "MERGEABLE",
            mergeStateStatus: "CLEAN",
            statusCheckRollup: [
              { conclusion: "SUCCESS" },
              { conclusion: "CANCELLED" },
            ],
            reviewDecision: "",
          },
        ]),
      ),
    );

    const { pr } = await fetchPrForBranch("acme", "widget", "cancelled-check");
    expect(pr!.checksStatus).toBe("cancelled");
  });

  it("maps checksStatus to cancelled for SKIPPED conclusion", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(
      mockExecFileSuccess(
        JSON.stringify([
          {
            number: 31,
            url: "https://github.com/acme/widget/pull/31",
            state: "OPEN",
            isDraft: false,
            mergeable: "MERGEABLE",
            mergeStateStatus: "CLEAN",
            statusCheckRollup: [{ conclusion: "SKIPPED" }],
            reviewDecision: "",
          },
        ]),
      ),
    );

    const { pr } = await fetchPrForBranch("acme", "widget", "skipped-check");
    expect(pr!.checksStatus).toBe("cancelled");
  });

  it("maps checksStatus to cancelled for TIMED_OUT conclusion", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(
      mockExecFileSuccess(
        JSON.stringify([
          {
            number: 32,
            url: "https://github.com/acme/widget/pull/32",
            state: "OPEN",
            isDraft: false,
            mergeable: "MERGEABLE",
            mergeStateStatus: "CLEAN",
            statusCheckRollup: [{ conclusion: "TIMED_OUT" }],
            reviewDecision: "",
          },
        ]),
      ),
    );

    const { pr } = await fetchPrForBranch("acme", "widget", "timed-out-check");
    expect(pr!.checksStatus).toBe("cancelled");
  });

  it("failure takes priority over cancelled in checksStatus", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(
      mockExecFileSuccess(
        JSON.stringify([
          {
            number: 33,
            url: "https://github.com/acme/widget/pull/33",
            state: "OPEN",
            isDraft: false,
            mergeable: "MERGEABLE",
            mergeStateStatus: "CLEAN",
            statusCheckRollup: [
              { conclusion: "CANCELLED" },
              { conclusion: "FAILURE" },
              { conclusion: "SUCCESS" },
            ],
            reviewDecision: "",
          },
        ]),
      ),
    );

    const { pr } = await fetchPrForBranch("acme", "widget", "fail-over-cancel");
    expect(pr!.checksStatus).toBe("failure");
  });

  // ── Checks: passed/total counts ───────────────────────────────────

  it("returns correct checksPassed and checksTotal counts", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(
      mockExecFileSuccess(
        JSON.stringify([
          {
            number: 34,
            url: "https://github.com/acme/widget/pull/34",
            state: "OPEN",
            isDraft: false,
            mergeable: "MERGEABLE",
            mergeStateStatus: "CLEAN",
            statusCheckRollup: [
              { conclusion: "SUCCESS" },
              { conclusion: "SUCCESS" },
              { conclusion: "FAILURE" },
            ],
            reviewDecision: "",
          },
        ]),
      ),
    );

    const { pr } = await fetchPrForBranch("acme", "widget", "counts-branch");
    expect(pr!.checksPassed).toBe(2);
    expect(pr!.checksTotal).toBe(3);
  });

  it("returns null checksPassed/checksTotal when no checks exist", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(
      mockExecFileSuccess(
        JSON.stringify([
          {
            number: 35,
            url: "https://github.com/acme/widget/pull/35",
            state: "OPEN",
            isDraft: false,
            mergeable: "MERGEABLE",
            mergeStateStatus: "CLEAN",
            statusCheckRollup: [],
            reviewDecision: "",
          },
        ]),
      ),
    );

    const { pr } = await fetchPrForBranch("acme", "widget", "no-checks");
    expect(pr!.checksPassed).toBeNull();
    expect(pr!.checksTotal).toBeNull();
    expect(pr!.checksStatus).toBe("success");
  });

  it("counts NEUTRAL conclusion as passed", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(
      mockExecFileSuccess(
        JSON.stringify([
          {
            number: 36,
            url: "https://github.com/acme/widget/pull/36",
            state: "OPEN",
            isDraft: false,
            mergeable: "MERGEABLE",
            mergeStateStatus: "CLEAN",
            statusCheckRollup: [
              { conclusion: "SUCCESS" },
              { conclusion: "NEUTRAL" },
            ],
            reviewDecision: "",
          },
        ]),
      ),
    );

    const { pr } = await fetchPrForBranch("acme", "widget", "neutral-check");
    expect(pr!.checksPassed).toBe(2);
    expect(pr!.checksTotal).toBe(2);
    expect(pr!.checksStatus).toBe("success");
  });

  // ── Review status ─────────────────────────────────────────────────

  it("maps reviewDecision APPROVED correctly", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(
      mockExecFileSuccess(
        JSON.stringify([
          {
            number: 37,
            url: "https://github.com/acme/widget/pull/37",
            state: "OPEN",
            isDraft: false,
            mergeable: "MERGEABLE",
            mergeStateStatus: "CLEAN",
            statusCheckRollup: [],
            reviewDecision: "APPROVED",
          },
        ]),
      ),
    );

    const { pr } = await fetchPrForBranch("acme", "widget", "approved-branch");
    expect(pr!.reviewStatus).toBe("approved");
  });

  it("maps reviewDecision CHANGES_REQUESTED correctly", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(
      mockExecFileSuccess(
        JSON.stringify([
          {
            number: 38,
            url: "https://github.com/acme/widget/pull/38",
            state: "OPEN",
            isDraft: false,
            mergeable: "MERGEABLE",
            mergeStateStatus: "BLOCKED",
            statusCheckRollup: [],
            reviewDecision: "CHANGES_REQUESTED",
          },
        ]),
      ),
    );

    const { pr } = await fetchPrForBranch("acme", "widget", "changes-requested");
    expect(pr!.reviewStatus).toBe("changes_requested");
    expect(pr!.mergeableState).toBe("blocked");
  });

  it("maps reviewDecision REVIEW_REQUIRED correctly", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(
      mockExecFileSuccess(
        JSON.stringify([
          {
            number: 39,
            url: "https://github.com/acme/widget/pull/39",
            state: "OPEN",
            isDraft: false,
            mergeable: "MERGEABLE",
            mergeStateStatus: "CLEAN",
            statusCheckRollup: [],
            reviewDecision: "REVIEW_REQUIRED",
          },
        ]),
      ),
    );

    const { pr } = await fetchPrForBranch("acme", "widget", "review-required");
    expect(pr!.reviewStatus).toBe("review_required");
  });

  it("maps empty reviewDecision to null", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(
      mockExecFileSuccess(
        JSON.stringify([
          {
            number: 40,
            url: "https://github.com/acme/widget/pull/40",
            state: "OPEN",
            isDraft: false,
            mergeable: "MERGEABLE",
            mergeStateStatus: "CLEAN",
            statusCheckRollup: [],
            reviewDecision: "",
          },
        ]),
      ),
    );

    const { pr } = await fetchPrForBranch("acme", "widget", "no-review");
    expect(pr!.reviewStatus).toBeNull();
  });
});
