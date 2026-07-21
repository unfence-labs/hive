import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ detectTools: vi.fn() }));
vi.mock("../detect.js", () => ({ detectTools: mocks.detectTools }));

import type { SetupStepAction } from "@hive/shared/setup-types";
import { ghAuthStep } from "./auth-gh.js";
import { makeFakePty } from "./fake-pty.js";

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

describe("ghAuthStep", () => {
  it("requires git credential setup even when already authenticated", async () => {
    mocks.detectTools.mockResolvedValue({ gh: { installed: true, authenticated: true } });
    const setupGit = vi.fn(async () => {});
    await ghAuthStep({ setupGit })(context().ctx);
    expect(setupGit).toHaveBeenCalledOnce();
  });

  it("fails if credential setup fails for an existing session", async () => {
    mocks.detectTools.mockResolvedValue({ gh: { installed: true, authenticated: true } });
    await expect(ghAuthStep({
      setupGit: async () => { throw new Error("git config is read-only"); },
    })(context().ctx)).rejects.toMatchObject({
      code: "UNKNOWN",
      detail: "git config is read-only",
    });
  });

  it("fails with an actionable error when gh is absent", async () => {
    mocks.detectTools.mockResolvedValue({ gh: { installed: false, authenticated: false } });
    await expect(ghAuthStep()(context().ctx)).rejects.toMatchObject({
      code: "UNKNOWN",
      detail: expect.stringContaining("provisioning"),
    });
  });

  it("surfaces the device action, verifies auth, and configures git", async () => {
    mocks.detectTools
      .mockResolvedValueOnce({ gh: { installed: true, authenticated: false } })
      .mockResolvedValueOnce({ gh: { installed: true, authenticated: true } });
    const { spawn } = makeFakePty("gh-auth-success.sh");
    const { ctx, actions } = context();
    const setupGit = vi.fn(async () => {});

    await ghAuthStep({ spawn, timeoutMs: 5_000, setupGit })(ctx);
    expect(actions).toEqual([{
      kind: "open_url_with_code",
      url: "https://github.com/login/device",
      code: "AB12-CD34",
    }]);
    expect(setupGit).toHaveBeenCalledOnce();
  });

  it("does not accept exit zero when auth is still absent", async () => {
    mocks.detectTools.mockResolvedValue({ gh: { installed: true, authenticated: false } });
    const { spawn } = makeFakePty("gh-auth-success.sh");
    await expect(ghAuthStep({ spawn, timeoutMs: 5_000 })(context().ctx)).rejects.toMatchObject({
      code: "GH_POLL_STUCK",
    });
  });

  it("maps an expired code to DEVICE_CODE_EXPIRED", async () => {
    mocks.detectTools.mockResolvedValue({ gh: { installed: true, authenticated: false } });
    const { spawn } = makeFakePty("gh-auth-expired.sh");
    await expect(ghAuthStep({ spawn, timeoutMs: 5_000 })(context().ctx)).rejects.toMatchObject({
      code: "DEVICE_CODE_EXPIRED",
    });
  });
});
