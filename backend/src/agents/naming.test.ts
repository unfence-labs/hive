import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  execFile: vi.fn((_cmd: string, _args: string[], cb: Function) => cb(null, { stdout: "", stderr: "" })),
}));

vi.mock("../utils/git.js", () => ({
  git: vi.fn(),
}));

import { spawn } from "node:child_process";
import { git } from "../utils/git.js";
import { sanitizeBranchName, ensureUniqueBranch, generateNames, runNamingTask } from "./naming.js";

const mockSpawn = vi.mocked(spawn);
const mockGit = vi.mocked(git);

function createMockStream(): EventEmitter {
  return new EventEmitter();
}

function createMockProcess() {
  const proc = new EventEmitter() as ChildProcess & {
    _stdout: EventEmitter;
    _stderr: EventEmitter;
    _stdinEnd: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
  };
  proc._stdout = createMockStream();
  proc._stderr = createMockStream();
  proc.stdout = proc._stdout as unknown as ChildProcess["stdout"];
  proc.stderr = proc._stderr as unknown as ChildProcess["stderr"];
  proc._stdinEnd = vi.fn();
  proc.stdin = { end: proc._stdinEnd } as unknown as ChildProcess["stdin"];
  proc.kill = vi.fn(() => true);
  return proc;
}

function baseContext(command?: string) {
  return {
    userMessage: "Please fix login redirect and add tests",
    cwd: "/tmp/workspace",
    bareRepo: "/tmp/repo.git",
    currentBranch: "workspace/hyderabad",
    workspaceName: "hyderabad",
    command,
  };
}

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("sanitizeBranchName", () => {
  it("lowercases input", () => {
    expect(sanitizeBranchName("Fix-Login-Bug")).toBe("fix-login-bug");
  });

  it("strips common prefixes", () => {
    expect(sanitizeBranchName("feat/add-auth")).toBe("add-auth");
    expect(sanitizeBranchName("fix/login-crash")).toBe("login-crash");
    expect(sanitizeBranchName("chore/cleanup")).toBe("cleanup");
    expect(sanitizeBranchName("refactor/api")).toBe("api");
    expect(sanitizeBranchName("docs/readme")).toBe("readme");
    expect(sanitizeBranchName("test/unit")).toBe("unit");
    expect(sanitizeBranchName("workspace/mumbai")).toBe("mumbai");
  });

  it("replaces spaces and underscores with hyphens", () => {
    expect(sanitizeBranchName("add user auth")).toBe("add-user-auth");
    expect(sanitizeBranchName("add_user_auth")).toBe("add-user-auth");
  });

  it("removes invalid characters", () => {
    expect(sanitizeBranchName("add-auth!@#$%")).toBe("add-auth");
  });

  it("collapses consecutive hyphens", () => {
    expect(sanitizeBranchName("add---auth")).toBe("add-auth");
  });

  it("trims leading and trailing hyphens", () => {
    expect(sanitizeBranchName("-add-auth-")).toBe("add-auth");
  });

  it("truncates to 50 characters", () => {
    const long = "a".repeat(60);
    expect(sanitizeBranchName(long).length).toBe(50);
  });

  it("returns empty for too-short results", () => {
    expect(sanitizeBranchName("ab")).toBe("");
    expect(sanitizeBranchName("--")).toBe("");
  });

  it("handles empty string", () => {
    expect(sanitizeBranchName("")).toBe("");
  });
});

describe("ensureUniqueBranch", () => {
  it("returns name as-is if unique", () => {
    expect(ensureUniqueBranch("add-auth", ["main", "dev"])).toBe("add-auth");
  });

  it("appends -2 if name exists", () => {
    expect(ensureUniqueBranch("add-auth", ["add-auth", "main"])).toBe("add-auth-2");
  });

  it("increments suffix until unique", () => {
    expect(ensureUniqueBranch("fix", ["fix", "fix-2", "fix-3"])).toBe("fix-4");
  });

  it("handles all suffixes taken up to -9", () => {
    const existing = ["name", ...Array.from({ length: 8 }, (_, i) => `name-${i + 2}`)];
    const result = ensureUniqueBranch("name", existing);
    // Should get a timestamp-based suffix
    expect(result).toMatch(/^name-[a-z0-9]{4}$/);
  });
});

describe("generateNames", () => {
  it("parses a direct JSON response from the naming command", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    queueMicrotask(() => {
      proc._stdout.emit("data", Buffer.from('{"branch_name":"fix-login","session_title":"Fix login redirect"}'));
      proc.emit("close", 0);
    });

    const result = await generateNames(baseContext("claude"));

    expect(result).toEqual({
      branchName: "fix-login",
      sessionTitle: "Fix login redirect",
    });
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(proc._stdinEnd).toHaveBeenCalledTimes(1);
  });

  it("accepts fenced JSON output", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    queueMicrotask(() => {
      proc._stdout.emit("data", Buffer.from("```json\n{\"branch_name\":\"auth-flow\",\"session_title\":\"Auth flow\"}\n```"));
      proc.emit("close", 0);
    });

    const result = await generateNames(baseContext("claude"));
    expect(result).toEqual({
      branchName: "auth-flow",
      sessionTitle: "Auth flow",
    });
  });

  it("returns empty result when output is not valid JSON", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    queueMicrotask(() => {
      proc._stdout.emit("data", Buffer.from("not-json"));
      proc.emit("close", 0);
    });

    await expect(generateNames(baseContext("claude"))).resolves.toEqual({});
  });

  it("returns empty result on process error", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    queueMicrotask(() => {
      proc.emit("error", new Error("spawn failed"));
    });

    await expect(generateNames(baseContext("claude"))).resolves.toEqual({});
  });

  it("kills the process and resolves empty object on timeout", async () => {
    vi.useFakeTimers();
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const pending = generateNames(baseContext("claude"));
    await vi.advanceTimersByTimeAsync(15_000);

    await expect(pending).resolves.toEqual({});
    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("truncates the user message to 500 chars in the generated prompt", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    queueMicrotask(() => {
      proc._stdout.emit("data", Buffer.from("{}"));
      proc.emit("close", 0);
    });

    const longMessage = "x".repeat(600);
    await generateNames({ ...baseContext("claude"), userMessage: longMessage });

    const args = mockSpawn.mock.calls[0]?.[1] as string[];
    const promptIndex = args.indexOf("-p");
    const prompt = args[promptIndex + 1];

    expect(prompt).toContain("x".repeat(500));
    expect(prompt).not.toContain("x".repeat(501));
  });
});

describe("runNamingTask", () => {
  it("skips the naming task when command is not claude", async () => {
    const onTitleReady = vi.fn();
    await runNamingTask(baseContext("bash"), onTitleReady);

    expect(mockSpawn).not.toHaveBeenCalled();
    expect(mockGit).not.toHaveBeenCalled();
    expect(onTitleReady).not.toHaveBeenCalled();
  });

  it("sets title even when branch should not be renamed", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const longTitle = "T".repeat(80);
    queueMicrotask(() => {
      proc._stdout.emit("data", Buffer.from(JSON.stringify({
        branch_name: "fix-login",
        session_title: longTitle,
      })));
      proc.emit("close", 0);
    });

    const onTitleReady = vi.fn();
    await runNamingTask(
      { ...baseContext("claude"), currentBranch: "feature/manual-branch" },
      onTitleReady,
    );

    expect(onTitleReady).toHaveBeenCalledTimes(1);
    expect(onTitleReady).toHaveBeenCalledWith(longTitle.slice(0, 60));
    expect(mockGit).not.toHaveBeenCalled();
  });

  it("renames workspace branch using sanitized and unique name", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    queueMicrotask(() => {
      proc._stdout.emit("data", Buffer.from(JSON.stringify({
        branch_name: "feat/Add Auth",
        session_title: "Add auth",
      })));
      proc.emit("close", 0);
    });

    mockGit
      .mockResolvedValueOnce({ stdout: "main\nadd-auth", stderr: "" })
      .mockResolvedValueOnce({ stdout: "workspace/hyderabad", stderr: "" })
      .mockResolvedValueOnce({ stdout: "", stderr: "" });

    const onTitleReady = vi.fn();
    await runNamingTask(baseContext("claude"), onTitleReady);

    expect(onTitleReady).toHaveBeenCalledWith("Add auth");
    expect(mockGit).toHaveBeenNthCalledWith(
      1,
      ["branch", "--format=%(refname:short)"],
      "/tmp/repo.git",
    );
    expect(mockGit).toHaveBeenNthCalledWith(
      2,
      ["rev-parse", "--abbrev-ref", "HEAD"],
      "/tmp/workspace",
    );
    expect(mockGit).toHaveBeenNthCalledWith(
      3,
      ["branch", "-m", "add-auth-2"],
      "/tmp/workspace",
    );
  });

  it("does not rename when sanitized branch name is empty", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    queueMicrotask(() => {
      proc._stdout.emit("data", Buffer.from(JSON.stringify({
        branch_name: "!!",
        session_title: "Some title",
      })));
      proc.emit("close", 0);
    });

    const onTitleReady = vi.fn();
    await runNamingTask(baseContext("claude"), onTitleReady);

    expect(onTitleReady).toHaveBeenCalledWith("Some title");
    expect(mockGit).not.toHaveBeenCalled();
  });

  it("does not rename when current branch is no longer a workspace branch", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    queueMicrotask(() => {
      proc._stdout.emit("data", Buffer.from(JSON.stringify({
        branch_name: "valid-name",
        session_title: "Valid title",
      })));
      proc.emit("close", 0);
    });

    mockGit
      .mockResolvedValueOnce({ stdout: "main", stderr: "" })
      .mockResolvedValueOnce({ stdout: "feature/already-renamed", stderr: "" });

    const onTitleReady = vi.fn();
    await runNamingTask(baseContext("claude"), onTitleReady);

    expect(onTitleReady).toHaveBeenCalledWith("Valid title");
    expect(mockGit).toHaveBeenCalledTimes(2);
    expect(mockGit).not.toHaveBeenCalledWith(["branch", "-m", "valid-name"], "/tmp/workspace");
  });

  it("swallows rev-parse failure and does not rename", async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    queueMicrotask(() => {
      proc._stdout.emit("data", Buffer.from(JSON.stringify({
        branch_name: "valid-name",
        session_title: "Valid title",
      })));
      proc.emit("close", 0);
    });

    mockGit
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
      .mockRejectedValueOnce(new Error("git failed"));

    await expect(runNamingTask(baseContext("claude"), vi.fn())).resolves.toBeUndefined();
    expect(mockGit).toHaveBeenCalledTimes(2);
  });
});
