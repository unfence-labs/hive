import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execImpl: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: (
    command: string,
    args: string[],
    optionsOrCallback: unknown,
    maybeCallback?: (...args: unknown[]) => void,
  ) => {
    const callback = (
      typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback
    ) as (...args: unknown[]) => void;
    Promise.resolve(mocks.execImpl(command, args))
      .then((output) => callback(null, output))
      .catch((error) => callback(error));
  },
}));

import { detectTools } from "./detect.js";

let previousClaudeToken: string | undefined;

beforeEach(() => {
  previousClaudeToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  mocks.execImpl.mockReset();
  mocks.execImpl.mockRejectedValue(new Error("not found"));
});

afterEach(() => {
  if (previousClaudeToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  else process.env.CLAUDE_CODE_OAUTH_TOKEN = previousClaudeToken;
  vi.clearAllMocks();
});

describe("detectTools", () => {
  it("reports only gh, Claude, and Codex with explicit booleans", async () => {
    expect(await detectTools()).toEqual({
      gh: { installed: false, authenticated: false },
      claude: { installed: false, authenticated: false },
      codex: { installed: false, authenticated: false },
    });
  });

  it("detects GitHub CLI authentication", async () => {
    mocks.execImpl.mockImplementation(async (command: string, args: string[]) => {
      if (command === "gh" && args[0] === "--version") return { stdout: "gh 2.40.0" };
      if (command === "gh" && args[0] === "auth") return { stdout: "logged in" };
      throw new Error("not found");
    });

    expect((await detectTools()).gh).toEqual({ installed: true, authenticated: true });
  });

  it("reports an installed but unauthenticated GitHub CLI", async () => {
    mocks.execImpl.mockImplementation(async (command: string, args: string[]) => {
      if (command === "gh" && args[0] === "--version") return { stdout: "gh 2.40.0" };
      throw new Error("not authenticated");
    });

    expect((await detectTools()).gh).toEqual({ installed: true, authenticated: false });
  });

  it("detects Claude auth from an explicit environment token", async () => {
    mocks.execImpl.mockImplementation(async (command: string, args: string[]) => {
      if (command === "claude" && args[0] === "--version") return { stdout: "Claude Code" };
      throw new Error("not found");
    });
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "sk-ant-oat01-env";
    expect((await detectTools()).claude.authenticated).toBe(true);
    expect(mocks.execImpl).not.toHaveBeenCalledWith("claude", ["auth", "status"]);
  });

  it("detects Claude auth through the CLI status probe", async () => {
    mocks.execImpl.mockImplementation(async (command: string, args: string[]) => {
      if (command === "claude" && args[0] === "--version") return { stdout: "Claude Code" };
      if (command === "claude" && args[0] === "auth") {
        return { stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }) };
      }
      throw new Error("not found");
    });

    expect((await detectTools()).claude).toEqual({ installed: true, authenticated: true });
    expect(mocks.execImpl).toHaveBeenCalledWith("claude", ["auth", "status"]);
  });

  it.each([
    ["logged out", JSON.stringify({ loggedIn: false })],
    ["empty", ""],
    ["corrupt", "not json"],
    ["stale", new Error("stored credentials expired")],
  ])("rejects %s Claude CLI status", async (_kind, statusResult) => {
    mocks.execImpl.mockImplementation(async (command: string, args: string[]) => {
      if (command === "claude" && args[0] === "--version") return { stdout: "Claude Code" };
      if (command === "claude" && args[0] === "auth") {
        if (statusResult instanceof Error) throw statusResult;
        return { stdout: statusResult };
      }
      throw new Error("not found");
    });

    expect((await detectTools()).claude).toEqual({ installed: true, authenticated: false });
  });

  it("detects Codex auth through the CLI status probe", async () => {
    mocks.execImpl.mockImplementation(async (command: string, args: string[]) => {
      if (command === "codex" && args[0] === "--version") return { stdout: "Codex" };
      if (command === "codex" && args[0] === "login") {
        return { stdout: "Logged in using ChatGPT", stderr: "" };
      }
      throw new Error("not found");
    });

    expect((await detectTools()).codex).toEqual({ installed: true, authenticated: true });
    expect(mocks.execImpl).toHaveBeenCalledWith("codex", ["login", "status"]);
  });

  it.each([
    ["empty", { stdout: "Not logged in", stderr: "" }],
    ["corrupt", new Error("failed to parse auth.json")],
    ["stale", new Error("stored credentials expired")],
  ])("does not accept an existing %s Codex auth file", async (_kind, statusResult) => {
    mocks.execImpl.mockImplementation(async (command: string, args: string[]) => {
      if (command === "codex" && args[0] === "--version") return { stdout: "Codex" };
      if (command === "codex" && args[0] === "login") {
        if (statusResult instanceof Error) throw statusResult;
        return statusResult;
      }
      throw new Error("not found");
    });

    expect((await detectTools()).codex).toEqual({ installed: true, authenticated: false });
  });

  it("does not cache stale results", async () => {
    await detectTools();
    const callsAfterFirstProbe = mocks.execImpl.mock.calls.length;
    await detectTools();
    expect(mocks.execImpl.mock.calls.length).toBe(callsAfterFirstProbe * 2);
  });
});
