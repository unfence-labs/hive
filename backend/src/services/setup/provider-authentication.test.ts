import { describe, expect, it, vi } from "vitest";
import type { CommandResult, RunCommand } from "./command.js";
import { ProviderAuthenticationCache } from "./provider-authentication.js";

function result(
  stdout: string,
  overrides: Partial<CommandResult> = {},
): CommandResult {
  return { stdout, stderr: "", exitCode: 0, timedOut: false, ...overrides };
}

function authenticationRun(
  states: { claude: CommandResult; codex: CommandResult },
): RunCommand {
  return vi.fn(async (command) => states[command as "claude" | "codex"]);
}

describe("ProviderAuthenticationCache", () => {
  it("stores definitive authentication states", async () => {
    const cache = new ProviderAuthenticationCache({
      detect: {
        run: authenticationRun({
          claude: result('{"loggedIn":true}'),
          codex: result("Not logged in"),
        }),
      },
    });

    await cache.refresh();

    expect(cache.getState("claude")).toBe("authenticated");
    expect(cache.getState("codex")).toBe("unauthenticated");
  });

  it("preserves the last definitive state when later probes are unknown", async () => {
    let timedOut = false;
    const run: RunCommand = vi.fn(async (command) => {
      if (timedOut) return result("", { exitCode: 1, timedOut: true });
      return command === "claude"
        ? result('{"loggedIn":true}')
        : result("Not logged in");
    });
    const cache = new ProviderAuthenticationCache({ detect: { run } });

    await cache.refresh();
    timedOut = true;
    await cache.refresh();

    expect(cache.getState("claude")).toBe("authenticated");
    expect(cache.getState("codex")).toBe("unauthenticated");
  });

  it("reports unknown when no probe has produced a reliable state", async () => {
    const cache = new ProviderAuthenticationCache({
      detect: {
        run: authenticationRun({
          claude: result("gateway unavailable", { exitCode: 1 }),
          codex: result("unexpected response"),
        }),
      },
    });

    await cache.refresh();

    expect(cache.getState("claude")).toBe("unknown");
    expect(cache.getState("codex")).toBe("unknown");
  });

  it("deduplicates concurrent refreshes and probes providers in parallel", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = vi.fn<RunCommand>(async (command) => {
      await gate;
      return command === "claude"
        ? result('{"loggedIn":true}')
        : result("Logged in using ChatGPT");
    });
    const cache = new ProviderAuthenticationCache({ detect: { run } });

    const first = cache.refresh();
    const second = cache.refresh();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    release();
    await Promise.all([first, second]);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("queues one fresh batch when an event overlaps an in-flight probe", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let batch = 0;
    const run = vi.fn<RunCommand>(async (command) => {
      const currentBatch = Math.floor(batch++ / 2);
      if (currentBatch === 0) await firstGate;
      if (command === "claude") {
        return result(currentBatch === 0 ? '{"loggedIn":false}' : '{"loggedIn":true}');
      }
      return result(currentBatch === 0 ? "Not logged in" : "Logged in using ChatGPT");
    });
    const cache = new ProviderAuthenticationCache({ detect: { run } });

    const staleRefresh = cache.refresh();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    const eventRefresh = cache.refresh({ force: true });
    const duplicateEventRefresh = cache.refresh({ force: true });
    releaseFirst();
    await Promise.all([staleRefresh, eventRefresh, duplicateEventRefresh]);

    expect(run).toHaveBeenCalledTimes(4);
    expect(cache.getState("claude")).toBe("authenticated");
    expect(cache.getState("codex")).toBe("authenticated");
  });

  it("returns a stale snapshot immediately while one background refresh runs", async () => {
    let now = 0;
    let release!: () => void;
    let block = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = vi.fn<RunCommand>(async (command) => {
      if (block) await gate;
      return command === "claude"
        ? result('{"loggedIn":true}')
        : result("Not logged in");
    });
    const cache = new ProviderAuthenticationCache({ detect: { run }, now: () => now });
    await cache.refresh();
    run.mockClear();
    now = 60_000;
    block = true;

    expect(cache.getState("claude")).toBe("authenticated");
    expect(cache.getState("claude")).toBe("authenticated");
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    release();
    await cache.refresh();
  });

  it("logs only the first unknown result in a failure series without CLI output", async () => {
    const warn = vi.fn();
    const cache = new ProviderAuthenticationCache({
      detect: {
        run: authenticationRun({
          claude: result("secret account data", { exitCode: 1, timedOut: true }),
          codex: result("Not logged in"),
        }),
      },
      logger: { warn },
      now: () => 42,
    });

    await cache.refresh();
    await cache.refresh();

    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      { provider: "claude", category: "timeout", durationMs: 0 },
      "provider authentication probe failed",
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret account data");
  });
});
