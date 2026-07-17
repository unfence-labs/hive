import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { PtyHandle, SpawnPty } from "./pty-auth.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(HERE, "..", "__fixtures__");

/**
 * Test-only fake PTY: runs a bash fixture stub (replaying recorded gh/codex
 * output) as a child process with piped stdio, adapted to the {@link PtyHandle}
 * interface. Not a real tty, but good enough to exercise parsing, Enter
 * injection (written to the child's stdin), and exit handling without the real
 * CLIs. Records every `write()` so tests can assert the Enter keystroke.
 */
export function makeFakePty(fixture: string): {
  spawn: SpawnPty;
  writes: string[];
} {
  const writes: string[] = [];
  const spawnFn: SpawnPty = (): PtyHandle => {
    // Force line-buffered stdout/stderr: bash writing to a pipe is otherwise
    // block-buffered by libc, so lines wouldn't arrive until the stub exits —
    // deadlocking fixtures that block on `read` waiting for injected Enter.
    const child = spawn("stdbuf", ["-oL", "-eL", "bash", join(FIXTURES_DIR, fixture)], {
      stdio: ["pipe", "pipe", "pipe"],
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
      write: (data) => {
        writes.push(data);
        try {
          // Emulate the tty line discipline: a real PTY maps the Enter key
          // (CR, "\r") to NL so line-oriented readers (`read` in the stub)
          // unblock. Our pipe does no such translation, so do it here.
          child.stdin.write(data.replace(/\r/g, "\n"));
        } catch {
          /* stdin may be closed */
        }
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
  return { spawn: spawnFn, writes };
}
