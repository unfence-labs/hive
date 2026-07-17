import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ detectTools: vi.fn() }));
vi.mock("../detect.js", () => ({ detectTools: mocks.detectTools }));

import { codexAuthStep } from "./auth-codex.js";
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
  return { ctx: { setAction: async (a) => void actions.push(a) }, actions };
}

beforeEach(() => {
  lines.length = 0;
  mocks.detectTools.mockReset();
});

describe("codexAuthStep", () => {
  it("skips when already authenticated", async () => {
    mocks.detectTools.mockResolvedValue({ codex: { installed: true, authenticated: true } });
    const { spawn } = makeFakePty("codex-auth-success.sh");
    const { ctx } = makeCtx();
    const result = await codexAuthStep({ spawn })(emit, ctx);
    expect(result).toMatchObject({ skipped: true });
  });

  it("parses the /codex/device URL variant + code and succeeds", async () => {
    mocks.detectTools.mockResolvedValue({ codex: { installed: true, authenticated: false } });
    const { spawn } = makeFakePty("codex-auth-success.sh");
    const { ctx, actions } = makeCtx();

    const result = await codexAuthStep({ spawn, timeoutMs: 5000 })(emit, ctx);

    expect(result).toMatchObject({ authenticated: true });
    expect(actions[0]).toEqual({
      kind: "open_url_with_code",
      url: "https://auth.openai.com/codex/device",
      code: "QWER-7890",
    });
  });

  it("parses the /device URL variant (not hardcoded)", async () => {
    mocks.detectTools.mockResolvedValue({ codex: { installed: true, authenticated: false } });
    const { spawn } = makeFakePty("codex-auth-alt-url.sh");
    const { ctx, actions } = makeCtx();

    const result = await codexAuthStep({ spawn, timeoutMs: 5000 })(emit, ctx);

    expect(result).toMatchObject({ authenticated: true });
    expect(actions[0]).toEqual({
      kind: "open_url_with_code",
      url: "https://auth.openai.com/device",
      code: "MNOP-2468",
    });
  });

  it("maps the disabled-workspace error to CODEX_DEVICE_AUTH_DISABLED", async () => {
    mocks.detectTools.mockResolvedValue({ codex: { installed: true, authenticated: false } });
    const { spawn } = makeFakePty("codex-auth-disabled.sh");
    const { ctx } = makeCtx();
    await expect(codexAuthStep({ spawn, timeoutMs: 5000 })(emit, ctx)).rejects.toMatchObject({
      code: "CODEX_DEVICE_AUTH_DISABLED",
    });
  });

  it("fails when codex is not installed", async () => {
    mocks.detectTools.mockResolvedValue({ codex: { installed: false } });
    const { spawn } = makeFakePty("codex-auth-success.sh");
    const { ctx } = makeCtx();
    await expect(codexAuthStep({ spawn })(emit, ctx)).rejects.toBeInstanceOf(StepError);
  });
});
