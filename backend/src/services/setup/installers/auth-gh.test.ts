import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ detectTools: vi.fn() }));
vi.mock("../detect.js", () => ({ detectTools: mocks.detectTools }));

import { ghAuthStep } from "./auth-gh.js";
import { makeFakePty } from "./fake-pty.js";
import { StepError } from "../operations.js";
import type { EmitFn, StepContext } from "../operations.js";
import type { SetupStepAction } from "@hive/shared/setup-types";

const lines: string[] = [];
const emit: EmitFn = async ({ line }) => {
  lines.push(line);
};

function makeCtx(): { ctx: StepContext; actions: SetupStepAction[] } {
  const actions: SetupStepAction[] = [];
  return {
    ctx: { setAction: async (a) => void actions.push(a) },
    actions,
  };
}

beforeEach(() => {
  lines.length = 0;
  mocks.detectTools.mockReset();
});

describe("ghAuthStep", () => {
  it("skips when already authenticated", async () => {
    mocks.detectTools.mockResolvedValue({ gh: { installed: true, authenticated: true } });
    const { spawn } = makeFakePty("gh-auth-success.sh");
    const { ctx } = makeCtx();
    const result = await ghAuthStep({ spawn })(emit, ctx);
    expect(result).toMatchObject({ skipped: true });
  });

  it("fails when gh is not installed", async () => {
    mocks.detectTools.mockResolvedValue({ gh: { installed: false } });
    const { spawn } = makeFakePty("gh-auth-success.sh");
    const { ctx } = makeCtx();
    await expect(ghAuthStep({ spawn })(emit, ctx)).rejects.toBeInstanceOf(StepError);
  });

  it("parses code + url, surfaces the action, sets up git, and succeeds", async () => {
    mocks.detectTools.mockResolvedValue({ gh: { installed: true, authenticated: false } });
    const { spawn } = makeFakePty("gh-auth-success.sh");
    const { ctx, actions } = makeCtx();
    const setupGit = vi.fn(async () => {});

    const result = await ghAuthStep({ spawn, timeoutMs: 5000, setupGit })(emit, ctx);

    expect(result).toMatchObject({ authenticated: true });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({
      kind: "open_url_with_code",
      url: "https://github.com/login/device",
      code: "AB12-CD34",
    });
    expect(setupGit).toHaveBeenCalledOnce();
  });

  it("maps expiry to DEVICE_CODE_EXPIRED", async () => {
    mocks.detectTools.mockResolvedValue({ gh: { installed: true, authenticated: false } });
    const { spawn } = makeFakePty("gh-auth-expired.sh");
    const { ctx } = makeCtx();
    await expect(ghAuthStep({ spawn, timeoutMs: 5000 })(emit, ctx)).rejects.toMatchObject({
      code: "DEVICE_CODE_EXPIRED",
    });
  });
});
