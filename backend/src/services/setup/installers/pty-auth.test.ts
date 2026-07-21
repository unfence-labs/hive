import { afterEach, describe, expect, it, vi } from "vitest";
import { drivePtyAuth, type PtyHandle, type SpawnPty } from "./pty-auth.js";

function fakeHandle(overrides: Partial<PtyHandle> = {}): PtyHandle & { kill: ReturnType<typeof vi.fn> } {
  return {
    onData: () => () => {},
    onExit: () => () => {},
    kill: vi.fn(),
    ...overrides,
  } as PtyHandle & { kill: ReturnType<typeof vi.fn> };
}

describe("drivePtyAuth", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("kills the process and resolves with reason timeout when nothing exits", async () => {
    vi.useFakeTimers();
    const handle = fakeHandle();
    const spawn: SpawnPty = () => handle;

    const result = drivePtyAuth({
      spawn,
      command: "gh auth login",
      cwd: "/tmp",
      timeoutMs: 1000,
      onChunk: () => {},
    });
    await vi.advanceTimersByTimeAsync(1000);

    await expect(result).resolves.toEqual({ buffer: "", exitCode: null, reason: "timeout" });
    expect(handle.kill).toHaveBeenCalledOnce();
  });

  it("resolves immediately when the process already exited before subscribing", async () => {
    const handle = fakeHandle({
      onExit: (cb) => {
        cb(0);
        return () => {};
      },
    });

    await expect(
      drivePtyAuth({ spawn: () => handle, command: "x", cwd: "/tmp", timeoutMs: 1000, onChunk: () => {} }),
    ).resolves.toEqual({ buffer: "", exitCode: 0, reason: "exit" });
    expect(handle.kill).not.toHaveBeenCalled();
  });

  it("accumulates output and hands the full buffer to onChunk", async () => {
    let emit: ((chunk: string) => void) | undefined;
    let exit: ((code: number) => void) | undefined;
    const handle = fakeHandle({
      onData: (cb) => {
        emit = cb;
        return () => {};
      },
      onExit: (cb) => {
        exit = cb;
        return () => {};
      },
    });
    const seen: string[] = [];

    const result = drivePtyAuth({
      spawn: () => handle,
      command: "x",
      cwd: "/tmp",
      timeoutMs: 1000,
      onChunk: (buffer) => seen.push(buffer),
    });
    emit?.("device code: ");
    emit?.("ABCD-1234");
    exit?.(0);

    await expect(result).resolves.toEqual({
      buffer: "device code: ABCD-1234",
      exitCode: 0,
      reason: "exit",
    });
    expect(seen).toEqual(["device code: ", "device code: ABCD-1234"]);
  });
});
