import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexAppServerRunner } from "./codex-app-server-runner.js";

class FakeAppServer extends EventEmitter {
  capturedTurnId: string | undefined;
  startTurn = vi.fn(async () => {});
  setGoal = vi.fn(async () => ({ threadId: "thread-1", goal: null }));
  getGoal = vi.fn(async () => ({ threadId: "thread-1", goal: null }));
  clearGoal = vi.fn(async () => ({ threadId: "thread-1", goal: null }));
  interruptActiveTurn = vi.fn();
  close = vi.fn(() => {
    this.capturedTurnId = undefined;
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("CodexAppServerRunner", () => {
  it.each(["user", "park", "close"] as const)("does not emit a startup error after %s closes a pending start", async (action) => {
    const appServer = new FakeAppServer();
    const runner = new CodexAppServerRunner(appServer);
    const errors = vi.fn();
    const results = vi.fn();
    runner.on("error", errors);
    runner.on("result", results);
    let rejectStart!: (error: Error) => void;
    appServer.startTurn.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
      rejectStart = reject;
    }));
    appServer.close.mockImplementationOnce(() => rejectStart(new Error("Codex app-server closed")));

    runner.startTurn({ cwd: "/tmp/project", content: "Hello" });
    if (action === "close") runner.close();
    else runner.stop(action);
    await Promise.resolve();

    expect(errors).not.toHaveBeenCalled();
    if (action !== "close") {
      expect(results).toHaveBeenCalledExactlyOnceWith({
        type: "result", session_id: "", status: "interrupted",
      });
    }
  });

  it("does not emit a startup error when an already announced turn is interrupted", async () => {
    vi.useFakeTimers();
    const appServer = new FakeAppServer();
    const runner = new CodexAppServerRunner(appServer);
    const errors = vi.fn();
    runner.on("error", errors);
    let rejectStart!: (error: Error) => void;
    appServer.startTurn.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
      rejectStart = reject;
    }));

    runner.startTurn({ cwd: "/tmp/project", content: "Hello" });
    appServer.capturedTurnId = "turn-1";
    runner.stop("user");
    rejectStart(new Error("Turn interrupted"));
    await Promise.resolve();

    expect(appServer.interruptActiveTurn).toHaveBeenCalledOnce();
    expect(appServer.close).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    runner.close();
  });

  it("ignores a stopped start's late failure while reporting the next start's failure", async () => {
    const appServer = new FakeAppServer();
    const runner = new CodexAppServerRunner(appServer);
    const errors = vi.fn();
    runner.on("error", errors);
    const rejectStarts: Array<(error: Error) => void> = [];
    appServer.startTurn.mockImplementation(() => new Promise<void>((_resolve, reject) => {
      rejectStarts.push(reject);
    }));

    runner.startTurn({ cwd: "/tmp/project", content: "First" });
    runner.stop("user");
    runner.startTurn({ cwd: "/tmp/project", content: "Retry" });
    rejectStarts[0]!(new Error("Codex app-server closed"));
    await Promise.resolve();
    expect(errors).not.toHaveBeenCalled();

    const failure = new Error("Failed to start Codex");
    rejectStarts[1]!(failure);
    await Promise.resolve();
    expect(errors).toHaveBeenCalledExactlyOnceWith(failure);
  });

  it("reports genuine startup and app-server errors", async () => {
    const appServer = new FakeAppServer();
    const runner = new CodexAppServerRunner(appServer);
    const errors = vi.fn();
    runner.on("error", errors);
    const startupError = new Error("Failed to start Codex");
    appServer.startTurn.mockRejectedValueOnce(startupError);

    runner.startTurn({ cwd: "/tmp/project", content: "Hello" });
    await Promise.resolve();
    expect(errors).toHaveBeenCalledExactlyOnceWith(startupError);

    const runtimeError = new Error("Codex connection lost");
    appServer.emit("error", runtimeError);
    expect(errors).toHaveBeenNthCalledWith(2, runtimeError);
  });

  it("closes immediately when stopped before a turn id exists", () => {
    const appServer = new FakeAppServer();
    const runner = new CodexAppServerRunner(appServer);

    runner.stop("user");

    expect(appServer.interruptActiveTurn).not.toHaveBeenCalled();
    expect(appServer.close).toHaveBeenCalledTimes(1);
  });

  it("emits an interrupted result when stopped without a turn to interrupt", () => {
    const appServer = new FakeAppServer();
    const runner = new CodexAppServerRunner(appServer);
    const results: unknown[] = [];
    runner.on("result", (event) => results.push(event));

    runner.stop("user");

    expect(results).toEqual([
      { type: "result", session_id: "", status: "interrupted" },
    ]);
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

  it("forwards goal commands to the app-server client", async () => {
    const appServer = new FakeAppServer();
    const runner = new CodexAppServerRunner(appServer);
    const options = { cwd: "/tmp/project", model: "gpt-5.5" };

    await runner.setGoal({ objective: "Ship backend support", status: "active" }, options);
    await runner.getGoal(options);
    await runner.clearGoal(options);

    expect(appServer.setGoal).toHaveBeenCalledWith(
      { objective: "Ship backend support", status: "active" },
      options,
    );
    expect(appServer.getGoal).toHaveBeenCalledWith(options);
    expect(appServer.clearGoal).toHaveBeenCalledWith(options);
  });
});
