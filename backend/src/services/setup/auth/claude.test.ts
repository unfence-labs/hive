import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolDetection } from "../detect.js";
import {
  CLAUDE_OAUTH_ERROR_PTY,
  CLAUDE_SETUP_TOKEN_PTY,
} from "./__fixtures__/cli-output.js";
import { claudeAuthFlow } from "./claude.js";
import { ToolAuthError, type AuthFlowContext, type AuthorizationPrompt } from "./flow.js";
import type { AuthProcess } from "./process.js";

const TOKEN = "sk-ant-oat01-AbC123_dEf456-GhI789jklMNO";

afterEach(() => {
  vi.restoreAllMocks();
});

function detection(overrides: Partial<ToolDetection> = {}): ToolDetection {
  return { installed: true, version: "2.1.217", authenticated: false, ...overrides };
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
  it("surfaces the link, takes the pasted code, and stores the token", async () => {
    const cli = fakeClaude();
    const writeToken = vi.fn<(token: string) => Promise<void>>().mockResolvedValue();
    const { ctx, prompts, states } = context();

    const handle = claudeAuthFlow({
      detect: async () => detection(),
      writeToken,
      spawn: (command, args) => cli.spawn(command, args),
    })(ctx);

    await cli.spawned;
    // Nothing secret is ever an argument; the command takes none at all.
    expect(cli.args).toEqual(["setup-token"]);

    cli.emit(CLAUDE_SETUP_TOKEN_PTY);
    await vi.waitFor(() => expect(prompts).toHaveLength(1));
    expect(prompts[0].verificationUri).toContain("claude.com/cai/oauth/authorize");
    expect(prompts[0].needsCode).toBe(true);

    handle.submitCode("abc123#xyz");
    // The code reaches the CLI over its stdin, followed by the return that
    // submits it — never as a command-line argument.
    expect(cli.written).toEqual(["abc123#xyz\r"]);
    expect(states).toContain("verifying");

    cli.emit(`\n  ${TOKEN}\n`);
    cli.finish(0);

    await expect(handle.done).resolves.toBe("connected");
    expect(writeToken).toHaveBeenCalledWith(TOKEN);
  });

  it("refuses a code before the CLI has asked for one", async () => {
    const cli = fakeClaude();
    const { ctx } = context();

    const handle = claudeAuthFlow({
      detect: async () => detection(),
      writeToken: async () => {},
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
      writeToken: async () => {},
      spawn: (command, args) => cli.spawn(command, args),
    })(ctx);

    await cli.spawned;
    cli.emit(CLAUDE_SETUP_TOKEN_PTY);
    await vi.waitFor(() => expect(prompts).toHaveLength(1));

    expect(() => handle.submitCode("abc123\rrm -rf /")).toThrow(/authorization code/i);
    expect(cli.written).toEqual([]);

    handle.cancel();
    await handle.done;
  });

  it("takes another code when the provider refuses the first, without exiting", async () => {
    const cli = fakeClaude();
    const writeToken = vi.fn<(token: string) => Promise<void>>().mockResolvedValue();
    const { ctx, prompts, states } = context();

    const handle = claudeAuthFlow({
      detect: async () => detection(),
      writeToken,
      spawn: (command, args) => cli.spawn(command, args),
    })(ctx);

    await cli.spawned;
    cli.emit(CLAUDE_SETUP_TOKEN_PTY);
    await vi.waitFor(() => expect(prompts).toHaveLength(1));

    handle.submitCode("wrong-code");
    cli.emit(CLAUDE_OAUTH_ERROR_PTY);

    // The CLI is still alive and offering a retry on the same link, so the
    // operator is put back in front of it with what went wrong.
    await vi.waitFor(() => expect(prompts).toHaveLength(2));
    expect(prompts[1]).toMatchObject({
      needsCode: true,
      verificationUri: prompts[0].verificationUri,
      notice: "Invalid code. Please make sure the full code was copied",
    });
    // The return the CLI asked for, so its prompt comes back.
    expect(cli.written).toEqual(["wrong-code\r", "\r"]);
    expect(cli.wasKilled()).toBe(false);

    handle.submitCode("right-code");
    expect(states.filter((state) => state === "verifying")).toHaveLength(2);
    cli.emit(`\n  ${TOKEN}\n`);

    await expect(handle.done).resolves.toBe("connected");
    expect(writeToken).toHaveBeenCalledWith(TOKEN);
  });

  it("does not replay an old rejection at the next code that is submitted", async () => {
    const cli = fakeClaude();
    const { ctx, prompts } = context();

    const handle = claudeAuthFlow({
      detect: async () => detection(),
      writeToken: async () => {},
      spawn: (command, args) => cli.spawn(command, args),
    })(ctx);

    await cli.spawned;
    cli.emit(CLAUDE_SETUP_TOKEN_PTY);
    await vi.waitFor(() => expect(prompts).toHaveLength(1));

    handle.submitCode("wrong-code");
    cli.emit(CLAUDE_OAUTH_ERROR_PTY);
    await vi.waitFor(() => expect(prompts).toHaveLength(2));

    // The complaint is still on the screen the CLI drew; the code echoed back
    // after it must not be read as having been refused too.
    handle.submitCode("right-code");
    cli.emit("right-code\n");
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(prompts).toHaveLength(2);

    handle.cancel();
    await handle.done;
  });

  it("settles as soon as the token is printed, without waiting for the exit", async () => {
    const cli = fakeClaude();
    const writeToken = vi.fn<(token: string) => Promise<void>>().mockResolvedValue();
    const { ctx, prompts } = context();

    const handle = claudeAuthFlow({
      detect: async () => detection(),
      writeToken,
      spawn: (command, args) => cli.spawn(command, args),
    })(ctx);

    await cli.spawned;
    cli.emit(CLAUDE_SETUP_TOKEN_PTY);
    await vi.waitFor(() => expect(prompts).toHaveLength(1));
    handle.submitCode("abc123");

    // No cli.finish(): the CLI lingers after printing the credential.
    cli.emit(`\n  ${TOKEN}\n`);

    await expect(handle.done).resolves.toBe("connected");
    expect(writeToken).toHaveBeenCalledWith(TOKEN);
    expect(cli.wasKilled()).toBe(true);
  });

  it("does not store a token that fails validation", async () => {
    const cli = fakeClaude();
    const writeToken = vi.fn<(token: string) => Promise<void>>().mockResolvedValue();
    const { ctx } = context();

    const handle = claudeAuthFlow({
      detect: async () => detection(),
      writeToken,
      spawn: (command, args) => cli.spawn(command, args),
    })(ctx);

    await cli.spawned;
    cli.emit("Your token: sk-ant-oat01-short\n");
    cli.finish(0);

    await expect(handle.done).rejects.toMatchObject({ reason: "no_credential" });
    expect(writeToken).not.toHaveBeenCalled();
  });

  it("keeps the token out of the output it reports on failure", async () => {
    const cli = fakeClaude();
    const { ctx } = context();

    const handle = claudeAuthFlow({
      detect: async () => detection(),
      writeToken: async () => {
        throw new Error("disk full");
      },
      spawn: (command, args) => cli.spawn(command, args),
    })(ctx);

    await cli.spawned;
    cli.emit(`printed ${TOKEN}\nthen failed\n`);
    cli.finish(1);

    const error = await handle.done.catch((e: unknown) => e);
    expect((error as Error).message).toBe("disk full");
    expect(JSON.stringify(error)).not.toContain(TOKEN);
  });

  it("redacts the token from a reported command failure", async () => {
    const cli = fakeClaude();
    const { ctx } = context();

    const handle = claudeAuthFlow({
      detect: async () => detection(),
      writeToken: async () => {},
      spawn: (command, args) => cli.spawn(command, args),
    })(ctx);

    await cli.spawned;
    cli.emit(`sk-ant-oat01-not!valid\nsomething broke\n`);
    cli.finish(2);

    const error = (await handle.done.catch((e: unknown) => e)) as ToolAuthError;
    expect(error.reason).toBe("command_failed");
    expect(error.outputExcerpt).toContain("something broke");
    expect(error.outputExcerpt).not.toContain("sk-ant-oat01-not");
  });

  it("refuses to start when Claude Code is not installed", async () => {
    const { ctx } = context();
    const handle = claudeAuthFlow({
      detect: async () => detection({ installed: false }),
      writeToken: async () => {},
      spawn: () => {
        throw new Error("must not spawn");
      },
    })(ctx);

    await expect(handle.done).rejects.toMatchObject({ reason: "not_installed" });
  });

  it("accepts a CLI that persisted its own session instead of printing a token", async () => {
    const cli = fakeClaude();
    const detect = vi
      .fn<() => Promise<ToolDetection>>()
      .mockResolvedValueOnce(detection({ authenticated: false }))
      .mockResolvedValue(detection({ authenticated: true }));
    const { ctx } = context();

    const handle = claudeAuthFlow({
      detect,
      writeToken: async () => {},
      spawn: (command, args) => cli.spawn(command, args),
    })(ctx);

    await cli.spawned;
    cli.finish(0);

    await expect(handle.done).resolves.toBe("connected");
  });

  it("does not read an existing sign-in as proof this attempt worked", async () => {
    const cli = fakeClaude();
    // Already signed in, so the probe would answer about the old credential.
    const detect = vi
      .fn<() => Promise<ToolDetection>>()
      .mockResolvedValue(detection({ authenticated: true }));
    const { ctx } = context();

    const handle = claudeAuthFlow({
      detect,
      writeToken: async () => {},
      spawn: (command, args) => cli.spawn(command, args),
    })(ctx);

    await cli.spawned;
    cli.finish(0);

    await expect(handle.done).rejects.toMatchObject({ reason: "no_credential" });
    expect(detect).toHaveBeenCalledTimes(1);
  });
});
