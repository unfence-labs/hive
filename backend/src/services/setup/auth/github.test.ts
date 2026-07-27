import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolAuthState } from "@hive/shared/setup-types";
import type { ToolDetection } from "../detect.js";
import { ToolAuthError, type AuthFlowContext, type AuthorizationPrompt } from "./flow.js";

// ── Mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  gh: vi.fn(),
  _resetGhState: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock("../../../utils/github.js", () => ({
  gh: mocks.gh,
  _resetGhState: mocks._resetGhState,
}));

vi.mock("node:child_process", () => ({
  execFile: mocks.execFile,
}));

import { githubAuthFlow, type GitHubAuthDeps } from "./github.js";

function detection(overrides: Partial<ToolDetection> = {}): ToolDetection {
  return { installed: true, version: "2.62.0", authenticated: false, ...overrides };
}

type FetchResponse = { ok: boolean; json: () => Promise<unknown>; text: () => Promise<string> };

function jsonResponse(body: unknown): FetchResponse {
  return { ok: true, json: async () => body, text: async () => JSON.stringify(body) };
}

function deviceCode(overrides: Record<string, unknown> = {}): FetchResponse {
  return jsonResponse({
    device_code: "dc-123",
    user_code: "ABCD-1234",
    verification_uri: "https://github.com/login/device",
    expires_in: 900,
    interval: 5,
    ...overrides,
  });
}

const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<FetchResponse>>();

function context(): {
  ctx: AuthFlowContext;
  prompts: AuthorizationPrompt[];
  states: ToolAuthState[];
} {
  const prompts: AuthorizationPrompt[] = [];
  const states: ToolAuthState[] = [];
  return {
    prompts,
    states,
    ctx: { prompt: (info) => prompts.push(info), setState: (state) => states.push(state) },
  };
}

/** Instant pacing that records what the flow asked to wait for. */
function instantSleep(): { delays: number[]; sleep: (ms: number) => Promise<void> } {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms) => {
      delays.push(ms);
    },
  };
}

function flow(overrides: Partial<GitHubAuthDeps> = {}) {
  return githubAuthFlow({
    detect: async () => detection(),
    fetch: fetchMock as unknown as typeof globalThis.fetch,
    sleep: instantSleep().sleep,
    ...overrides,
  });
}

function ghLoginSucceeds(): { stdin: string[] } {
  const stdin: string[] = [];
  mocks.execFile.mockImplementation(
    (_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
      cb(null);
      return { stdin: { write: (data: string) => stdin.push(data), end: vi.fn() } };
    },
  );
  return { stdin };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gh.mockResolvedValue({ stdout: "", stderr: "" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("github sign-in", () => {
  it("surfaces the code, polls until authorized, then signs the CLI in", async () => {
    fetchMock
      .mockResolvedValueOnce(deviceCode())
      .mockResolvedValueOnce(jsonResponse({ error: "authorization_pending" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "gho_token_123" }));
    const { stdin } = ghLoginSucceeds();
    const { ctx, prompts, states } = context();

    const handle = flow()(ctx);

    await expect(handle.done).resolves.toBe("connected");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({
      verificationUri: "https://github.com/login/device",
      userCode: "ABCD-1234",
    });
    // Bounded by GitHub's own expires_in.
    expect(prompts[0].expiresAt).toBeInstanceOf(Date);
    expect(states).toContain("verifying");

    // The token reaches gh over stdin, never argv.
    expect(mocks.execFile).toHaveBeenCalledWith(
      "gh",
      ["auth", "login", "--hostname", "github.com", "--with-token"],
      expect.any(Function),
    );
    expect(stdin).toEqual(["gho_token_123\n"]);
    expect(mocks._resetGhState).toHaveBeenCalled();
    expect(mocks.gh).toHaveBeenCalledWith(["auth", "setup-git"]);
  });

  it("polls at GitHub's pace and slows down when told to", async () => {
    fetchMock
      .mockResolvedValueOnce(deviceCode({ interval: 5 }))
      .mockResolvedValueOnce(jsonResponse({ error: "authorization_pending" }))
      .mockResolvedValueOnce(jsonResponse({ error: "slow_down", interval: 10 }))
      .mockResolvedValueOnce(jsonResponse({ error: "authorization_pending" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "gho_token_123" }));
    ghLoginSucceeds();
    const pacing = instantSleep();
    const { ctx } = context();

    const handle = flow({ sleep: pacing.sleep })(ctx);

    await expect(handle.done).resolves.toBe("connected");
    expect(pacing.delays).toEqual([5_000, 5_000, 10_000, 10_000]);
  });

  it("requests the scopes pushes and org repositories need, and no more", async () => {
    fetchMock
      .mockResolvedValueOnce(deviceCode())
      .mockResolvedValueOnce(jsonResponse({ error: "expired_token" }));
    const { ctx } = context();

    await flow()(ctx).done;

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.scope.split(" ")).toContain("workflow");
    // Repository deletion is not something every operator should have to grant.
    expect(body.scope.split(" ")).not.toContain("delete_repo");
  });

  it("uses GITHUB_CLIENT_ID env var when set", async () => {
    vi.stubEnv("GITHUB_CLIENT_ID", "custom-client-id");
    fetchMock
      .mockResolvedValueOnce(deviceCode())
      .mockResolvedValueOnce(jsonResponse({ error: "expired_token" }));
    const { ctx } = context();

    await flow()(ctx).done;

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).client_id).toBe(
      "custom-client-id",
    );
    vi.unstubAllEnvs();
  });

  it("reports an expired code as expired rather than as a failure", async () => {
    fetchMock
      .mockResolvedValueOnce(deviceCode())
      .mockResolvedValueOnce(jsonResponse({ error: "expired_token" }));
    const { ctx } = context();

    await expect(flow()(ctx).done).resolves.toBe("expired");
  });

  it("stops polling once GitHub's deadline has passed", async () => {
    // An expiry already in the past stands in for the clock running out.
    fetchMock.mockResolvedValueOnce(deviceCode({ expires_in: -1 }));
    const { ctx } = context();

    await expect(flow()(ctx).done).resolves.toBe("expired");
    // Only the device-code request: the token endpoint was never bothered.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a refusal on GitHub's page as a cancellation", async () => {
    fetchMock
      .mockResolvedValueOnce(deviceCode())
      .mockResolvedValueOnce(jsonResponse({ error: "access_denied" }));
    const { ctx } = context();

    await expect(flow()(ctx).done).resolves.toBe("cancelled");
  });

  it("cancels a flow mid-poll without waiting out the pause", async () => {
    fetchMock
      .mockResolvedValueOnce(deviceCode())
      .mockResolvedValue(jsonResponse({ error: "authorization_pending" }));
    const { ctx, prompts } = context();

    // A pause that never ends on its own: only the cancel can wake it.
    const handle = flow({ sleep: () => new Promise<void>(() => {}) })(ctx);
    await vi.waitFor(() => expect(prompts).toHaveLength(1));
    handle.cancel();

    await expect(handle.done).resolves.toBe("cancelled");
  });

  it("refuses to start when the CLI is not installed", async () => {
    const { ctx } = context();

    const handle = flow({ detect: async () => detection({ installed: false }) })(ctx);

    await expect(handle.done).rejects.toMatchObject({ reason: "not_installed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a rejected device-code request as a command failure", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({}),
      text: async () => "rate limited",
    });
    const { ctx } = context();

    await expect(flow()(ctx).done).rejects.toMatchObject({
      reason: "command_failed",
      message: expect.stringContaining("rate limited"),
    });
  });

  it("reports a gh CLI sign-in failure with its output", async () => {
    fetchMock
      .mockResolvedValueOnce(deviceCode())
      .mockResolvedValueOnce(jsonResponse({ access_token: "gho_bad" }));
    mocks.execFile.mockImplementation(
      (_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
        cb(Object.assign(new Error("exit 1"), { stderr: "gh: keyring unavailable" }));
        return { stdin: { write: vi.fn(), end: vi.fn() } };
      },
    );
    const { ctx } = context();

    const error = await flow()(ctx).done.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolAuthError);
    expect(error).toMatchObject({ reason: "command_failed" });
    expect((error as ToolAuthError).outputExcerpt).toContain("keyring unavailable");
  });

  it("names a git credential helper failure instead of swallowing it", async () => {
    fetchMock
      .mockResolvedValueOnce(deviceCode())
      .mockResolvedValueOnce(jsonResponse({ access_token: "gho_token_123" }));
    ghLoginSucceeds();
    mocks.gh.mockRejectedValue(
      Object.assign(new Error("exit 1"), { stderr: "gh: could not write .gitconfig" }),
    );
    const { ctx } = context();

    // The token is stored and gh is signed in, but the flow did not deliver
    // everything it promises — reported, or it surfaces later as a push that
    // fails for no visible reason.
    await expect(flow()(ctx).done).rejects.toMatchObject({
      reason: "command_failed",
      message: expect.stringContaining("configuring git credentials failed"),
    });
  });

  it("reports a success response with no token as no credential", async () => {
    fetchMock
      .mockResolvedValueOnce(deviceCode())
      .mockResolvedValueOnce(jsonResponse({}));
    const { ctx } = context();

    await expect(flow()(ctx).done).rejects.toMatchObject({ reason: "no_credential" });
  });
});
