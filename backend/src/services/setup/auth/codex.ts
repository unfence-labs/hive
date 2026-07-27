import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RunCommand } from "../command.js";
import type { ToolDetection } from "../detect.js";
import { ToolAuthError, type AuthFlow, type ToolAuthOutcome } from "./flow.js";
import { outputTail, parseDeviceCode, parseVerificationUri, stripAnsi } from "./output.js";
import { spawnPipedAuthProcess, type AuthProcess, type SpawnAuthProcess } from "./process.js";

/**
 * Codex sign-in.
 *
 * `codex login --device-auth` is a device-code flow that needs no terminal at
 * all: it prints the verification link and a one-time code to stdout, then
 * polls the provider itself. So it runs as an ordinary piped child process,
 * and Hive's only jobs are to read the code out and to bound the wait.
 *
 * The flow has one destructive property that shapes everything below: starting
 * it deletes the existing credential immediately, before it has earned a
 * replacement. An operator who starts a sign-in and walks away is therefore
 * signed out of a Codex that was working. The credential is copied aside
 * before the command runs and put back whenever the flow ends any way other
 * than connected — including a crash, which `recoverCodexCredential` repairs
 * at the next boot.
 */

/** The code the CLI prints is good for 15 minutes; waiting longer is waiting for nothing. */
const DEFAULT_TIMEOUT_MS = 15 * 60_000;

const AUTH_FILE = "auth.json";
const BACKUP_FILE = "auth.json.hive-backup";

/** Where Codex keeps its credential. `CODEX_HOME` wins, as it does for the CLI. */
export function codexHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.CODEX_HOME?.trim() || join(env.HOME?.trim() || homedir(), ".codex");
}

async function readIfPresent(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Write a credential with owner-only permissions, whether or not it existed. */
async function writeCredential(path: string, contents: Buffer): Promise<void> {
  await writeFile(path, contents, { mode: 0o600 });
  await chmod(path, 0o600);
}

/**
 * Copy the current credential aside. Returns false when there was nothing to
 * protect, which is the ordinary case of a first sign-in.
 */
export async function backupCodexCredential(home = codexHome()): Promise<boolean> {
  const current = await readIfPresent(join(home, AUTH_FILE));
  if (!current) return false;
  await writeCredential(join(home, BACKUP_FILE), current);
  return true;
}

/** Put the saved credential back and drop the copy. */
export async function restoreCodexCredential(home = codexHome()): Promise<boolean> {
  const backup = await readIfPresent(join(home, BACKUP_FILE));
  if (!backup) return false;
  await writeCredential(join(home, AUTH_FILE), backup);
  await rm(join(home, BACKUP_FILE), { force: true });
  return true;
}

export async function discardCodexBackup(home = codexHome()): Promise<void> {
  await rm(join(home, BACKUP_FILE), { force: true });
}

/**
 * Repair a sign-in that Hive was killed in the middle of.
 *
 * A backup left behind means a flow started and never reported an ending. If
 * the credential is gone, the flow was still running when the process died and
 * the operator is now signed out of a Codex that worked — put it back. If a
 * credential is there, the flow had already succeeded and only the tidying was
 * lost, so the copy is simply dropped rather than written over a newer one.
 */
export async function recoverCodexCredential(home = codexHome()): Promise<boolean> {
  const backup = await readIfPresent(join(home, BACKUP_FILE));
  if (!backup) return false;
  const current = await readIfPresent(join(home, AUTH_FILE));
  if (current) {
    await discardCodexBackup(home);
    return false;
  }
  await writeCredential(join(home, AUTH_FILE), backup);
  await rm(join(home, BACKUP_FILE), { force: true });
  return true;
}

/**
 * Whether the installed CLI has the flag at all.
 *
 * Asking the CLI what it supports beats comparing version strings: the help
 * output is the same thing that decides whether the command will run, whereas
 * a version threshold is a claim about release history that would be wrong the
 * moment the flag was backported or renamed.
 */
export async function supportsDeviceAuth(run: RunCommand): Promise<boolean> {
  const result = await run("codex", ["login", "--help"], { timeoutMs: 10_000 });
  if (result.exitCode !== 0) return false;
  return `${result.stdout}\n${result.stderr}`.includes("--device-auth");
}

export interface CodexAuthDeps {
  detect: () => Promise<ToolDetection>;
  run: RunCommand;
  spawn?: SpawnAuthProcess;
  timeoutMs?: number;
  home?: string;
}

type RaceResult = { kind: "exit"; code: number } | { kind: "timeout" };

function raceExit(process: AuthProcess, timeoutMs: number): Promise<RaceResult> {
  return new Promise<RaceResult>((resolve) => {
    const timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
    timer.unref?.();
    void process.exit.then((code) => {
      clearTimeout(timer);
      resolve({ kind: "exit", code });
    });
  });
}

export function codexAuthFlow(deps: CodexAuthDeps): AuthFlow {
  const spawn = deps.spawn ?? spawnPipedAuthProcess;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return (ctx) => {
    let child: AuthProcess | null = null;
    let buffer = "";
    let cancelled = false;
    let promptShown = false;

    const done = (async (): Promise<ToolAuthOutcome> => {
      const home = deps.home ?? codexHome();
      const before = await deps.detect();
      if (!before.installed) {
        throw new ToolAuthError("not_installed", "Codex is not installed on this server.");
      }
      if (!(await supportsDeviceAuth(deps.run))) {
        throw new ToolAuthError(
          "unsupported_cli",
          `Codex ${before.version ?? "on this server"} does not support device sign-in ` +
            "(codex login --device-auth). Update Codex, then try again.",
        );
      }
      if (cancelled) return "cancelled";

      // Everything past this point can leave the server signed out, so the
      // credential goes somewhere safe first.
      await backupCodexCredential(home);

      let connected = false;
      try {
        child = spawn("codex", ["login", "--device-auth"]);
        const active = child;
        active.onData((chunk) => {
          buffer += chunk;
          if (promptShown) return;
          const verificationUri = parseVerificationUri(buffer);
          const userCode = parseDeviceCode(buffer);
          if (!verificationUri || !userCode) return;
          promptShown = true;
          ctx.prompt({
            verificationUri,
            userCode,
            expiresAt: new Date(Date.now() + timeoutMs),
          });
        });

        const result = await raceExit(active, timeoutMs);
        if (cancelled) {
          active.kill();
          return "cancelled";
        }

        if (result.kind === "timeout") {
          active.kill();
          return "expired";
        }

        if (result.code === 0) {
          ctx.setState("verifying");
          const after = await deps.detect();
          if (after.authenticated) {
            connected = true;
            return "connected";
          }
          throw new ToolAuthError(
            "no_credential",
            "Codex sign-in finished but the CLI still reports no session.",
            { outputExcerpt: outputTail(buffer) },
          );
        }

        // A non-zero exit after the code was on screen is what running out of
        // time looks like from here; before it, the command never got started.
        if (promptShown || /expire/i.test(stripAnsi(buffer))) return "expired";
        throw new ToolAuthError(
          "command_failed",
          `Codex sign-in exited with code ${result.code}.`,
          { outputExcerpt: outputTail(buffer) },
        );
      } finally {
        if (connected) {
          await discardCodexBackup(home);
        } else {
          await restoreCodexCredential(home);
        }
      }
    })();

    return {
      done,
      submitCode: () => {
        throw new Error("Codex confirms the code in the browser; there is nothing to paste back.");
      },
      cancel: () => {
        cancelled = true;
        child?.kill();
      },
    };
  };
}
