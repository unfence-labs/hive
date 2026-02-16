import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseGitHubRepo, fetchPrForBranch, _resetGhState } from "./github.js";

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
  return (_cmd: string, _args: string[], _opts: unknown, cb: (...args: unknown[]) => void) => {
    cb(null, { stdout, stderr: "" });
  };
}

function mockExecFileError(error: { code?: string; stderr?: string; message?: string }) {
  return (_cmd: string, _args: string[], _opts: unknown, cb: (...args: unknown[]) => void) => {
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
    });
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
          },
        ]),
      ),
    );

    const { pr } = await fetchPrForBranch("acme", "widget", "conflict-branch");
    expect(pr!.mergeable).toBe(false);
    expect(pr!.mergeableState).toBe("conflict");
  });

  it("maps BLOCKED mergeStateStatus to conflict", async () => {
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
          },
        ]),
      ),
    );

    const { pr } = await fetchPrForBranch("acme", "widget", "blocked-branch");
    expect(pr!.mergeableState).toBe("conflict");
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
          },
        ]),
      ),
    );

    const { pr } = await fetchPrForBranch("acme", "widget", "state-fail");
    expect(pr!.checksStatus).toBe("failure");
  });

  // ── Error handling ──────────────────────────────────────────────────

  it("permanently disables gh on ENOENT error", async () => {
    const execFileMock = await getExecFileMock();
    execFileMock.mockImplementation(
      mockExecFileError({ code: "ENOENT" }),
    );

    const first = await fetchPrForBranch("acme", "widget", "branch-1");
    expect(first.pr).toBeNull();
    expect(first.error).toBe("gh CLI not installed");

    // Second call should skip gh entirely (fast-path)
    execFileMock.mockClear();
    const second = await fetchPrForBranch("acme", "widget", "branch-2");
    expect(second.pr).toBeNull();
    expect(second.error).toBe("gh CLI not installed");
    expect(execFileMock).not.toHaveBeenCalled();
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
});
