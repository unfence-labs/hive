import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ detectTools: vi.fn() }));
vi.mock("../detect.js", () => ({ detectTools: mocks.detectTools }));

import type { SetupStepAction } from "@hive/shared/setup-types";
import { codexAuthStep } from "./auth-codex.js";
import { makeFakePty } from "./fake-pty.js";
import type { SpawnPty } from "./pty-auth.js";

function context(): { ctx: { setAction: (action: SetupStepAction) => Promise<void> }; actions: SetupStepAction[] } {
  const actions: SetupStepAction[] = [];
  return {
    ctx: { setAction: async (action) => { actions.push(action); } },
    actions,
  };
}

beforeEach(() => {
  mocks.detectTools.mockReset();
});

describe("codexAuthStep", () => {
  it("skips an authenticated installation", async () => {
    mocks.detectTools.mockResolvedValue({ codex: { installed: true, authenticated: true } });
    await expect(codexAuthStep()(context().ctx)).resolves.toBeUndefined();
  });

  it("surfaces the parsed device URL and requires post-exit auth", async () => {
    mocks.detectTools
      .mockResolvedValueOnce({ codex: { installed: true, authenticated: false } })
      .mockResolvedValueOnce({ codex: { installed: true, authenticated: true } });
    const { spawn } = makeFakePty("codex-auth-success.sh");
    const { ctx, actions } = context();

    await codexAuthStep({ spawn, timeoutMs: 5_000 })(ctx);
    expect(actions).toEqual([{
      kind: "open_url_with_code",
      url: "https://auth.openai.com/codex/device",
      code: "QWER-7890",
    }]);
  });

  it("accepts the alternate /device URL variant", async () => {
    mocks.detectTools
      .mockResolvedValueOnce({ codex: { installed: true, authenticated: false } })
      .mockResolvedValueOnce({ codex: { installed: true, authenticated: true } });
    const { spawn } = makeFakePty("codex-auth-alt-url.sh");
    const { ctx, actions } = context();
    await codexAuthStep({ spawn, timeoutMs: 5_000 })(ctx);
    expect(actions[0].url).toBe("https://auth.openai.com/device");
  });

  it("does not treat success output as permission to kill the process", async () => {
    mocks.detectTools
      .mockResolvedValueOnce({ codex: { installed: true, authenticated: false } })
      .mockResolvedValueOnce({ codex: { installed: true, authenticated: true } });
    let onData: ((chunk: string) => void) | undefined;
    let onExit: ((code: number) => void) | undefined;
    let killed = false;
    const spawn: SpawnPty = () => ({
      onData: (callback) => { onData = callback; return () => {}; },
      onExit: (callback) => { onExit = callback; return () => {}; },
      kill: () => { killed = true; },
    });

    let settled = false;
    const login = codexAuthStep({ spawn, timeoutMs: 5_000 })(context().ctx)
      .finally(() => { settled = true; });
    onData?.("Successfully logged in to ChatGPT.");
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(settled).toBe(false);
    expect(killed).toBe(false);

    onExit?.(0);
    await login;
  });

  it("fails when exit zero did not produce authenticated credentials", async () => {
    mocks.detectTools.mockResolvedValue({ codex: { installed: true, authenticated: false } });
    const { spawn } = makeFakePty("codex-auth-success.sh");
    await expect(codexAuthStep({ spawn, timeoutMs: 5_000 })(context().ctx)).rejects.toMatchObject({
      code: "UNKNOWN",
      message: expect.stringContaining("without an authenticated session"),
    });
  });

  it("maps a disabled workspace and rejects a missing install", async () => {
    mocks.detectTools.mockResolvedValue({ codex: { installed: true, authenticated: false } });
    const { spawn } = makeFakePty("codex-auth-disabled.sh");
    await expect(codexAuthStep({ spawn, timeoutMs: 5_000 })(context().ctx)).rejects.toMatchObject({
      code: "CODEX_DEVICE_AUTH_DISABLED",
    });

    mocks.detectTools.mockResolvedValue({ codex: { installed: false, authenticated: false } });
    await expect(codexAuthStep()(context().ctx)).rejects.toMatchObject({ code: "UNKNOWN" });
  });
});
