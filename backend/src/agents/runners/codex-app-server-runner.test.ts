import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexAppServerRunner } from "./codex-app-server-runner.js";

class FakeAppServer extends EventEmitter {
  capturedTurnId: string | undefined;
  startTurn = vi.fn(async () => {});
  interruptActiveTurn = vi.fn();
  close = vi.fn(() => {
    this.capturedTurnId = undefined;
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("CodexAppServerRunner", () => {
  it("closes immediately when stopped before a turn id exists", () => {
    const appServer = new FakeAppServer();
    const runner = new CodexAppServerRunner(appServer);

    runner.stop("user");

    expect(appServer.interruptActiveTurn).not.toHaveBeenCalled();
    expect(appServer.close).toHaveBeenCalledTimes(1);
  });

  it("interrupts an active turn and waits for completion on user stop", () => {
    vi.useFakeTimers();
    const appServer = new FakeAppServer();
    appServer.capturedTurnId = "turn-1";
    const runner = new CodexAppServerRunner(appServer);

    runner.stop("user");

    expect(appServer.interruptActiveTurn).toHaveBeenCalledTimes(1);
    expect(appServer.close).not.toHaveBeenCalled();
  });

  it("closes immediately for park stops after interrupting the active turn", () => {
    const appServer = new FakeAppServer();
    appServer.capturedTurnId = "turn-1";
    const runner = new CodexAppServerRunner(appServer);

    runner.stop("park");

    expect(appServer.interruptActiveTurn).toHaveBeenCalledTimes(1);
    expect(appServer.close).toHaveBeenCalledTimes(1);
  });

  it("closes on interrupt timeout only while the same turn is still active", async () => {
    vi.useFakeTimers();
    const appServer = new FakeAppServer();
    appServer.capturedTurnId = "turn-1";
    const runner = new CodexAppServerRunner(appServer);

    runner.stop("user");
    await vi.advanceTimersByTimeAsync(5000);

    expect(appServer.close).toHaveBeenCalledTimes(1);
  });

  it("does not close a newer turn from a stale interrupt timeout", async () => {
    vi.useFakeTimers();
    const appServer = new FakeAppServer();
    appServer.capturedTurnId = "turn-1";
    const runner = new CodexAppServerRunner(appServer);

    runner.stop("user");
    appServer.capturedTurnId = "turn-2";
    await vi.advanceTimersByTimeAsync(5000);

    expect(appServer.close).not.toHaveBeenCalled();
  });

  it("forwards native turn_started events", () => {
    const appServer = new FakeAppServer();
    const runner = new CodexAppServerRunner(appServer);
    const events: unknown[] = [];
    runner.on("turn_started", (event) => events.push(event));

    appServer.emit("turn_started", { threadId: "thread-1", turnId: "turn-1" });

    expect(events).toEqual([{ threadId: "thread-1", turnId: "turn-1" }]);
  });
});
