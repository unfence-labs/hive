import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  markServerUpdatePrompted,
  resetServerUpdate,
  runServerUpdate,
  serverVersionDiffersFromApp,
  shouldPromptServerUpdate,
  useServerUpdateState,
  type ServerUpdateState,
} from "@/lib/server-update";
import type { ProvisionClient, ProvisionRecord } from "@/lib/provision-client";

const TARGET = { host: "203.0.113.10", user: "root", keyPath: "/home/lenny/.ssh/id_ed25519" };

function clientWith(install: ProvisionClient["install"]): ProvisionClient {
  return {
    listKeys: vi.fn(),
    testConnection: vi.fn(),
    trustHost: vi.fn(),
    preflight: vi.fn(),
    install,
  };
}

beforeEach(() => {
  resetServerUpdate();
});

describe("runServerUpdate", () => {
  it("narrates step records and ends done", async () => {
    let emit: (record: ProvisionRecord) => void = () => {};
    let finish: () => void = () => {};
    const install = vi.fn(
      (_request, onRecord: (record: ProvisionRecord) => void) =>
        new Promise<void>((resolve) => {
          emit = onRecord;
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useServerUpdateState());

    let run: Promise<ServerUpdateState>;
    act(() => {
      run = runServerUpdate(clientWith(install), TARGET);
    });
    expect(result.current).toEqual({ phase: "running", step: "Connecting to the server…" });

    act(() => emit({ step: "stop_service", status: "start" }));
    expect(result.current).toEqual({ phase: "running", step: "Stop service" });

    act(() => emit({ step: "health_check", status: "start", title: "Waiting for the backend" }));
    expect(result.current).toEqual({ phase: "running", step: "Waiting for the backend" });

    await act(async () => {
      finish();
      await run;
    });
    expect(result.current).toEqual({ phase: "done" });
    expect(install).toHaveBeenCalledWith(
      {
        connection: { host: TARGET.host, user: TARGET.user, keyPath: TARGET.keyPath },
        options: { update: true },
        password: undefined,
      },
      expect.any(Function),
    );
  });

  it("flags a missing escalation password as recoverable", async () => {
    const install = vi.fn(() =>
      Promise.reject({ code: "SSH_PASSWORD_REQUIRED", detail: "a password is needed" }),
    );

    const result = await runServerUpdate(clientWith(install), TARGET);

    expect(result).toEqual({
      phase: "failed",
      error: "a password is needed",
      passwordRequired: true,
    });
  });

  it("reports other failures as terminal", async () => {
    const install = vi.fn(() => Promise.reject({ code: "HEALTH_TIMEOUT", detail: "no health" }));

    const result = await runServerUpdate(clientWith(install), TARGET);

    expect(result).toEqual({ phase: "failed", error: "no health", passwordRequired: false });
  });

  it("refuses to start a second run while one is in flight", async () => {
    let finish: () => void = () => {};
    const install = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const client = clientWith(install);

    const first = runServerUpdate(client, TARGET);
    const second = await runServerUpdate(client, TARGET);

    expect(second.phase).toBe("running");
    expect(install).toHaveBeenCalledTimes(1);
    finish();
    await first;
  });
});

describe("serverVersionDiffersFromApp", () => {
  it("flags only a comparable, differing backend", () => {
    expect(serverVersionDiffersFromApp("1.3.0", "1.2.3")).toBe(true);
    // A newer backend also differs: the button converges to the app's version
    // and names its target, so the downgrade is a visible choice.
    expect(serverVersionDiffersFromApp("1.2.3", "1.3.0")).toBe(true);
    expect(serverVersionDiffersFromApp("1.3.0", "1.3.0")).toBe(false);
    // A source checkout has no comparable version.
    expect(serverVersionDiffersFromApp("1.3.0", "dev")).toBe(false);
    expect(serverVersionDiffersFromApp(null, "1.2.3")).toBe(false);
    expect(serverVersionDiffersFromApp("1.3.0", null)).toBe(false);
  });
});

describe("mismatch prompt gate", () => {
  it("prompts once per launch", () => {
    expect(shouldPromptServerUpdate()).toBe(true);
    markServerUpdatePrompted();
    expect(shouldPromptServerUpdate()).toBe(false);
    resetServerUpdate();
    expect(shouldPromptServerUpdate()).toBe(true);
  });
});
