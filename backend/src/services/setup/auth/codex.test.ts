import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandResult, RunCommand } from "../command.js";
import type { ToolDetection } from "../detect.js";
import { CODEX_DEVICE_AUTH_STDOUT } from "./__fixtures__/cli-output.js";
import { codexAuthFlow, recoverCodexCredential } from "./codex.js";
import { ToolAuthError, type AuthFlowContext, type AuthorizationPrompt } from "./flow.js";
import type { AuthProcess } from "./process.js";

const CREDENTIAL = '{"tokens":{"access_token":"original"}}';

let home: string;
let authPath: string;
let backupPath: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "hive-codex-"));
  authPath = join(home, "auth.json");
  backupPath = join(home, "auth.json.hive-backup");
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function ok(stdout: string): CommandResult {
  return { stdout, stderr: "", exitCode: 0, timedOut: false };
}

/** A `codex login --help` that advertises the flag, and one that does not. */
const modernHelp: RunCommand = async () => ok("Options:\n      --device-auth\n");
const ancientHelp: RunCommand = async () => ok("Options:\n      --with-api-key\n");

function detection(overrides: Partial<ToolDetection> = {}): ToolDetection {
  return { installed: true, version: "0.145.0", authenticated: false, ...overrides };
}

/**
 * A stand-in for the CLI that reproduces the behaviour this whole design
 * exists for: starting the flow deletes the stored credential immediately,
 * before anything has replaced it.
 */
function fakeCodex() {
  const listeners: ((chunk: string) => void)[] = [];
  let settle!: (code: number) => void;
  const exit = new Promise<number>((resolve) => {
    settle = resolve;
  });
  let killed = false;

  const process: AuthProcess = {
    onData: (listener) => listeners.push(listener),
    write: () => {},
    kill: () => {
      killed = true;
      settle(143);
    },
    exit,
  };

  let started!: () => void;
  // The flow probes and copies the credential aside before it spawns anything,
  // so a test that emits output immediately would emit it into the void.
  const spawned = new Promise<void>((resolve) => {
    started = resolve;
  });

  return {
    spawn: () => {
      // The destructive side effect, reproduced.
      void rm(authPath, { force: true });
      started();
      return process;
    },
    spawned,
    emit: (chunk: string) => listeners.forEach((listener) => listener(chunk)),
    finish: (code: number) => settle(code),
    wasKilled: () => killed,
  };
}

function context(): { ctx: AuthFlowContext; prompts: AuthorizationPrompt[] } {
  const prompts: AuthorizationPrompt[] = [];
  return {
    prompts,
    ctx: { prompt: (info) => prompts.push(info), setState: () => {} },
  };
}

describe("codex sign-in", () => {
  it("surfaces the link and code from the CLI's own output, then connects", async () => {
    await writeFile(authPath, CREDENTIAL);
    const cli = fakeCodex();
    const detect = vi
      .fn<() => Promise<ToolDetection>>()
      .mockResolvedValueOnce(detection())
      .mockResolvedValue(detection({ authenticated: true }));
    const { ctx, prompts } = context();

    const handle = codexAuthFlow({
      detect,
      run: modernHelp,
      spawn: cli.spawn,
      home,
    })(ctx);

    await cli.spawned;
    cli.emit(CODEX_DEVICE_AUTH_STDOUT);
    await vi.waitFor(() => expect(prompts).toHaveLength(1));
    expect(prompts[0]).toMatchObject({
      verificationUri: "https://auth.openai.com/codex/device",
      userCode: "U927-TJEHB",
    });
    // Bounded, and bounded by the CLI's own 15-minute claim.
    expect(prompts[0].expiresAt).toBeInstanceOf(Date);

    cli.finish(0);
    await expect(handle.done).resolves.toBe("connected");

    // Nothing left behind once the credential it protected is not needed.
    await expect(stat(backupPath)).rejects.toThrow();
  });

  it("puts the credential back when the code expires", async () => {
    await writeFile(authPath, CREDENTIAL);
    const cli = fakeCodex();
    const { ctx } = context();

    const handle = codexAuthFlow({
      detect: async () => detection(),
      run: modernHelp,
      spawn: cli.spawn,
      home,
      timeoutMs: 10,
    })(ctx);

    await cli.spawned;
    cli.emit(CODEX_DEVICE_AUTH_STDOUT);

    // Expiry is an outcome, not a failure: nothing malfunctioned.
    await expect(handle.done).resolves.toBe("expired");
    expect(cli.wasKilled()).toBe(true);
    // The operator is not signed out of the Codex that was working.
    expect(await readFile(authPath, "utf-8")).toBe(CREDENTIAL);
    await expect(stat(backupPath)).rejects.toThrow();
  });

  it("puts the credential back when the operator abandons the flow", async () => {
    await writeFile(authPath, CREDENTIAL);
    const cli = fakeCodex();
    const { ctx } = context();

    const handle = codexAuthFlow({
      detect: async () => detection(),
      run: modernHelp,
      spawn: cli.spawn,
      home,
    })(ctx);

    await cli.spawned;
    cli.emit(CODEX_DEVICE_AUTH_STDOUT);
    await vi.waitFor(async () => {
      await expect(stat(backupPath)).resolves.toBeDefined();
    });
    handle.cancel();

    await expect(handle.done).resolves.toBe("cancelled");
    expect(await readFile(authPath, "utf-8")).toBe(CREDENTIAL);
    await expect(stat(backupPath)).rejects.toThrow();
  });

  it("refuses to start on a CLI without the flag, and touches nothing", async () => {
    await writeFile(authPath, CREDENTIAL);
    const cli = fakeCodex();
    const { ctx } = context();

    const handle = codexAuthFlow({
      detect: async () => detection({ version: "0.90.0" }),
      run: ancientHelp,
      spawn: cli.spawn,
      home,
    })(ctx);

    await expect(handle.done).rejects.toMatchObject({
      reason: "unsupported_cli",
      message: expect.stringContaining("0.90.0"),
    });
    // The point of checking first: a credential that was never at risk.
    expect(await readFile(authPath, "utf-8")).toBe(CREDENTIAL);
  });

  it("refuses to start when Codex is not installed", async () => {
    const { ctx } = context();
    const handle = codexAuthFlow({
      detect: async () => detection({ installed: false }),
      run: modernHelp,
      spawn: fakeCodex().spawn,
      home,
    })(ctx);

    await expect(handle.done).rejects.toMatchObject({ reason: "not_installed" });
  });

  it("reports a failure before the code appeared as a command failure", async () => {
    const cli = fakeCodex();
    const { ctx } = context();

    const handle = codexAuthFlow({
      detect: async () => detection(),
      run: modernHelp,
      spawn: cli.spawn,
      home,
    })(ctx);

    await cli.spawned;
    cli.emit("error: could not reach auth.openai.com\n");
    cli.finish(1);

    const error = await handle.done.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolAuthError);
    expect(error).toMatchObject({ reason: "command_failed" });
    expect((error as ToolAuthError).outputExcerpt).toContain("auth.openai.com");
  });

  it("does not claim success when the CLI exits clean but leaves no session", async () => {
    const cli = fakeCodex();
    const { ctx } = context();

    const handle = codexAuthFlow({
      detect: async () => detection({ authenticated: false }),
      run: modernHelp,
      spawn: cli.spawn,
      home,
    })(ctx);

    await cli.spawned;
    cli.emit(CODEX_DEVICE_AUTH_STDOUT);
    cli.finish(0);

    await expect(handle.done).rejects.toMatchObject({ reason: "no_credential" });
  });
});

describe("recovering from a sign-in Hive was killed during", () => {
  it("restores a credential the abandoned flow deleted", async () => {
    await writeFile(backupPath, CREDENTIAL);

    await expect(recoverCodexCredential(home)).resolves.toBe(true);

    expect(await readFile(authPath, "utf-8")).toBe(CREDENTIAL);
    await expect(stat(backupPath)).rejects.toThrow();
    expect((await stat(authPath)).mode & 0o777).toBe(0o600);
  });

  it("keeps a newer credential and drops the stale copy", async () => {
    await writeFile(backupPath, CREDENTIAL);
    await writeFile(authPath, '{"tokens":{"access_token":"newer"}}');

    await expect(recoverCodexCredential(home)).resolves.toBe(false);

    expect(await readFile(authPath, "utf-8")).toContain("newer");
    await expect(stat(backupPath)).rejects.toThrow();
  });

  it("does nothing when no sign-in was interrupted", async () => {
    await expect(recoverCodexCredential(home)).resolves.toBe(false);
  });
});
