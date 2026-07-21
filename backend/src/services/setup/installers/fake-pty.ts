import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { PtyHandle, SpawnPty } from "./pty-auth.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(HERE, "..", "__fixtures__");

/**
 * Test-only fake PTY: runs a bash fixture stub (replaying recorded gh/codex
 * output) as a child process with piped stdio, adapted to the {@link PtyHandle}
 * interface. Not a real tty, but enough to exercise parsing and exit handling
 * without invoking the real CLIs.
 */
export function makeFakePty(fixture: string): {
  spawn: SpawnPty;
} {
  const spawnFn: SpawnPty = (): PtyHandle => {
    // Force line-buffered output so tests observe device codes before exit.
    const child = spawn("stdbuf", ["-oL", "-eL", "bash", join(FIXTURES_DIR, fixture)], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const dataCbs = new Set<(chunk: string) => void>();
    const exitCbs = new Set<(code: number) => void>();

    const emit = (chunk: string) => {
      for (const cb of dataCbs) cb(chunk);
    };
    child.stdout.on("data", (b: Buffer) => emit(b.toString("utf8")));
    child.stderr.on("data", (b: Buffer) => emit(b.toString("utf8")));
    child.on("close", (code) => {
      for (const cb of exitCbs) cb(code ?? 0);
    });

    return {
      onData: (cb) => {
        dataCbs.add(cb);
        return () => dataCbs.delete(cb);
      },
      onExit: (cb) => {
        exitCbs.add(cb);
        return () => exitCbs.delete(cb);
      },
      kill: () => {
        try {
          child.kill();
        } catch {
          /* already gone */
        }
      },
    };
  };
  return { spawn: spawnFn };
}
