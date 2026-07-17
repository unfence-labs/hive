import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  execImpl: vi.fn(),
  accessImpl: vi.fn(),
}));

// promisify(execFile) calls execFile(cmd, args, options, callback). We route
// everything through a single configurable implementation keyed on cmd/args.
vi.mock("node:child_process", () => ({
  execFile: (
    cmd: string,
    args: string[],
    optionsOrCb: unknown,
    maybeCb?: (...cbArgs: unknown[]) => void,
  ) => {
    const cb = (typeof optionsOrCb === "function" ? optionsOrCb : maybeCb) as (
      ...cbArgs: unknown[]
    ) => void;
    Promise.resolve()
      .then(() => mocks.execImpl(cmd, args))
      .then((out) => cb(null, out))
      .catch((err) => cb(err));
  },
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, access: (path: string) => mocks.accessImpl(path) };
});

import { detectTools, _resetDetectCache } from "./detect.js";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  _resetDetectCache();
  mocks.execImpl.mockReset();
  mocks.accessImpl.mockReset();
  // Default: nothing installed, no files, npm returns nothing.
  mocks.execImpl.mockRejectedValue(new Error("not found"));
  mocks.accessImpl.mockRejectedValue(new Error("ENOENT"));
  globalThis.fetch = vi.fn(async () => new Response("Not Found", { status: 404 })) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("detectTools", () => {
  it("reports a tool as not installed when command -v fails", async () => {
    const detected = await detectTools({ force: true });
    expect(detected.node).toEqual({ installed: false });
    expect(detected.docker).toEqual({ installed: false });
  });

  it("reports installed + version for a present tool", async () => {
    mocks.execImpl.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "command" && args[1] === "node") return { stdout: "/usr/bin/node", stderr: "" };
      if (cmd === "node") return { stdout: "v22.17.0", stderr: "" };
      throw new Error("not found");
    });

    const detected = await detectTools({ force: true });
    expect(detected.node?.installed).toBe(true);
    expect(detected.node?.version).toBe("22.17.0");
    // node is not an auth tool.
    expect(detected.node?.authenticated).toBeUndefined();
  });

  it("detects gh authenticated via `gh auth status`", async () => {
    mocks.execImpl.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "command" && args[1] === "gh") return { stdout: "/usr/bin/gh", stderr: "" };
      if (cmd === "gh" && args[0] === "--version") return { stdout: "gh version 2.40.0", stderr: "" };
      if (cmd === "gh" && args[0] === "auth") return { stdout: "Logged in", stderr: "" };
      throw new Error("not found");
    });

    const detected = await detectTools({ force: true });
    expect(detected.gh?.installed).toBe(true);
    expect(detected.gh?.authenticated).toBe(true);
    expect(detected.gh?.version).toBe("2.40.0");
  });

  it("reports gh unauthenticated when `gh auth status` fails", async () => {
    mocks.execImpl.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "command" && args[1] === "gh") return { stdout: "/usr/bin/gh", stderr: "" };
      if (cmd === "gh" && args[0] === "--version") return { stdout: "gh version 2.40.0", stderr: "" };
      throw new Error("not authed");
    });

    const detected = await detectTools({ force: true });
    expect(detected.gh?.authenticated).toBe(false);
  });

  it("detects tailscale authenticated via BackendState=Running", async () => {
    mocks.execImpl.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "command" && args[1] === "tailscale") return { stdout: "/usr/bin/tailscale", stderr: "" };
      if (cmd === "tailscale" && args[0] === "version") return { stdout: "1.60.0", stderr: "" };
      if (cmd === "tailscale" && args[0] === "status") {
        return { stdout: JSON.stringify({ BackendState: "Running" }), stderr: "" };
      }
      throw new Error("not found");
    });

    const detected = await detectTools({ force: true });
    expect(detected.tailscale?.authenticated).toBe(true);
  });

  it("detects claude authenticated via the credentials file", async () => {
    mocks.execImpl.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "command" && args[1] === "claude") return { stdout: "/usr/bin/claude", stderr: "" };
      if (cmd === "claude") return { stdout: "2.1.53 (Claude Code)", stderr: "" };
      throw new Error("not found");
    });
    mocks.accessImpl.mockImplementation(async (path: string) => {
      if (path.endsWith(".credentials.json")) return undefined;
      throw new Error("ENOENT");
    });

    const detected = await detectTools({ force: true });
    expect(detected.claude?.installed).toBe(true);
    expect(detected.claude?.authenticated).toBe(true);
    expect(detected.claude?.version).toBe("2.1.53");
  });

  it("detects claude authenticated via CLAUDE_CODE_OAUTH_TOKEN env", async () => {
    const prev = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "sk-ant-oat01-x";
    mocks.execImpl.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "command" && args[1] === "claude") return { stdout: "/usr/bin/claude", stderr: "" };
      if (cmd === "claude") return { stdout: "2.1.53", stderr: "" };
      throw new Error("not found");
    });

    const detected = await detectTools({ force: true });
    expect(detected.claude?.authenticated).toBe(true);

    if (prev === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = prev;
  });

  it("computes latestVersion / updateAvailable for claude from npm", async () => {
    mocks.execImpl.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "command" && args[1] === "claude") return { stdout: "/usr/bin/claude", stderr: "" };
      if (cmd === "claude") return { stdout: "2.1.0", stderr: "" };
      throw new Error("not found");
    });
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("@anthropic-ai/claude-code")) {
        return new Response(JSON.stringify({ version: "2.1.53" }), { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const detected = await detectTools({ force: true });
    expect(detected.claude?.latestVersion).toBe("2.1.53");
    expect(detected.claude?.updateAvailable).toBe(true);
  });

  it("caches results within the TTL", async () => {
    mocks.execImpl.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "command" && args[1] === "node") return { stdout: "/usr/bin/node", stderr: "" };
      if (cmd === "node") return { stdout: "v22.0.0", stderr: "" };
      throw new Error("not found");
    });

    await detectTools({ force: true });
    const callsAfterFirst = mocks.execImpl.mock.calls.length;
    await detectTools(); // cached — should not re-probe
    expect(mocks.execImpl.mock.calls.length).toBe(callsAfterFirst);
  });
});
