import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolDetection } from "../detect.js";
import {
  CLAUDE_AUTH_LOGIN_PTY,
  CLAUDE_OAUTH_ERROR_PTY,
} from "./__fixtures__/cli-output.js";
import { claudeAuthFlow } from "./claude.js";
import { ToolAuthError, type AuthFlowContext, type AuthorizationPrompt } from "./flow.js";
import type { AuthProcess } from "./process.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function detection(overrides: Partial<ToolDetection> = {}): ToolDetection {
  return { installed: true, version: "2.1.220", authenticated: false, ...overrides };
}

function fakeClaude() {
  const listeners: ((chunk: string) => void)[] = [];
  const written: string[] = [];
  let settle!: (code: number) => void;
  const exit = new Promise<number>((resolve) => {
    settle = resolve;
  });
  let killed = false;
  let started!: () => void;
  const spawned = new Promise<void>((resolve) => {
    started = resolve;
  });

  const process: AuthProcess = {
    onData: (listener) => listeners.push(listener),
    write: (data) => written.push(data),
    kill: () => {
      killed = true;
      settle(143);
    },
    exit,
  };

  return {
    args: [] as string[],
    spawn(_command: string, args: string[]) {
      this.args = args;
      started();
      return process;
    },
    spawned,
    written,
    emit: (chunk: string) => listeners.forEach((listener) => listener(chunk)),
    finish: (code: number) => settle(code),
    wasKilled: () => killed,
  };
}

function context(): {
  ctx: AuthFlowContext;
  prompts: AuthorizationPrompt[];
  states: string[];
} {
  const prompts: AuthorizationPrompt[] = [];
  const states: string[] = [];
  return {
    prompts,
    states,
    ctx: {
      prompt: (info) => prompts.push(info),
      setState: (state) => states.push(state),
    },
  };
}

describe("claude sign-in", () => {
  it("runs the full-scope login, relays its link and accepts the pasted code", async () => {
    const cli = fakeClaude();
    const detect = vi
      .fn<() => Promise<ToolDetection>>()
      .mockResolvedValueOnce(detection())
      .mockResolvedValueOnce(detection({ authenticated: true }));
    const { ctx, prompts, states } = context();

    const handle = claudeAuthFlow({
      detect,
      spawn: (command, args) => cli.spawn(command, args),
    })(ctx);

    await cli.spawned;
    expect(cli.args).toEqual(["auth", "login", "--claudeai"]);

    cli.emit(CLAUDE_AUTH_LOGIN_PTY);
    await vi.waitFor(() => expect(prompts).toHaveLength(1));
    expect(prompts[0].verificationUri).toContain("claude.com/cai/oauth/authorize");
    expect(prompts[0].verificationUri).toContain("user%3Aprofile");
    expect(prompts[0].needsCode).toBe(true);

    handle.submitCode("abc123#xyz");
    await vi.waitFor(() => expect(cli.written).toEqual(["abc123#xyz", "\r"]));
    expect(states).toContain("verifying");

    cli.finish(0);
    await expect(handle.done).resolves.toBe("connected");
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it("refuses a code before the CLI has asked for one", async () => {
    const cli = fakeClaude();
    const { ctx } = context();
    const handle = claudeAuthFlow({
      detect: async () => detection(),
      spawn: (command, args) => cli.spawn(command, args),
    })(ctx);

    await cli.spawned;
    expect(() => handle.submitCode("abc123")).toThrow(/not waiting for a code/i);

    handle.cancel();
    await expect(handle.done).resolves.toBe("cancelled");
  });

  it("rejects a code that could smuggle a second answer past the prompt", async () => {
    const cli = fakeClaude();
    const { ctx, prompts } = context();
    const handle = claudeAuthFlow({
      detect: async () => detection(),
      spawn: (command, args) => cli.spawn(command, args),
    })(ctx);

    await cli.spawned;
    cli.emit(CLAUDE_AUTH_LOGIN_PTY);
    await vi.waitFor(() => expect(prompts).toHaveLength(1));

    expect(() => handle.submitCode("abc123\rrm -rf /")).toThrow(/authorization code/i);
    expect(cli.written).toEqual([]);

    handle.cancel();
    await handle.done;
  });

  it("takes another code when the provider refuses the first", async () => {
    const cli = fakeClaude();
    const detect = vi
      .fn<() => Promise<ToolDetection>>()
      .mockResolvedValueOnce(detection())
      .mockResolvedValueOnce(detection({ authenticated: true }));
    const { ctx, prompts, states } = context();
    const handle = claudeAuthFlow({
      detect,
      spawn: (command, args) => cli.spawn(command, args),
    })(ctx);

    await cli.spawned;
    cli.emit(CLAUDE_AUTH_LOGIN_PTY);
    await vi.waitFor(() => expect(prompts).toHaveLength(1));

    handle.submitCode("wrong-code");
    cli.emit(CLAUDE_OAUTH_ERROR_PTY);

    await vi.waitFor(() => expect(prompts).toHaveLength(2));
    expect(prompts[1]).toMatchObject({
      needsCode: true,
      verificationUri: prompts[0].verificationUri,
      notice: "Invalid code. Please make sure the full code was copied",
    });
    await vi.waitFor(() => expect(cli.written).toEqual(["wrong-code", "\r", "\r"]));
    expect(cli.wasKilled()).toBe(false);

    handle.submitCode("right-code");
    expect(states.filter((state) => state === "verifying")).toHaveLength(2);
    cli.finish(0);
    await expect(handle.done).resolves.toBe("connected");
  });

  it("does not replay an old rejection at the next code", async () => {
    const cli = fakeClaude();
    const { ctx, prompts } = context();
    const handle = claudeAuthFlow({
      detect: async () => detection(),
      spawn: (command, args) => cli.spawn(command, args),
    })(ctx);

    await cli.spawned;
    cli.emit(CLAUDE_AUTH_LOGIN_PTY);
    await vi.waitFor(() => expect(prompts).toHaveLength(1));
    handle.submitCode("wrong-code");
    cli.emit(CLAUDE_OAUTH_ERROR_PTY);
    await vi.waitFor(() => expect(prompts).toHaveLength(2));

    handle.submitCode("right-code");
    cli.emit("right-code\n");
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(prompts).toHaveLength(2);

    handle.cancel();
    await handle.done;
  });

  it("reports a successful command that saved no credential", async () => {
    const cli = fakeClaude();
    const { ctx } = context();
    const handle = claudeAuthFlow({
      detect: async () => detection(),
      spawn: (command, args) => cli.spawn(command, args),
    })(ctx);

    await cli.spawned;
    cli.finish(0);

    await expect(handle.done).rejects.toMatchObject({ reason: "no_credential" });
  });

  it("redacts credentials from a reported command failure", async () => {
    const cli = fakeClaude();
    const { ctx } = context();
    const handle = claudeAuthFlow({
      detect: async () => detection(),
      spawn: (command, args) => cli.spawn(command, args),
    })(ctx);

    await cli.spawned;
    cli.emit("sk-ant-oat01-not-valid\nsomething broke\n");
    cli.finish(2);

    const error = (await handle.done.catch((value: unknown) => value)) as ToolAuthError;
    expect(error.reason).toBe("command_failed");
    expect(error.outputExcerpt).toContain("something broke");
    expect(error.outputExcerpt).not.toContain("sk-ant-oat01-not");
  });

  it("refuses to start when Claude Code is not installed", async () => {
    const { ctx } = context();
    const handle = claudeAuthFlow({
      detect: async () => detection({ installed: false }),
      spawn: () => {
        throw new Error("must not spawn");
      },
    })(ctx);

    await expect(handle.done).rejects.toMatchObject({ reason: "not_installed" });
  });
});
