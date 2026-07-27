import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

// ── Mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  gh: vi.fn(),
  isGhInstalled: vi.fn(),
  _resetGhState: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock("../utils/github.js", () => ({
  gh: mocks.gh,
  isGhInstalled: mocks.isGhInstalled,
  _resetGhState: mocks._resetGhState,
}));

vi.mock("node:child_process", () => ({
  execFile: mocks.execFile,
}));

// Mock global fetch for GitHub API calls
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { accountRoutes } from "./account.js";

let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.isGhInstalled.mockResolvedValue(true);
  mocks.gh.mockResolvedValue({ stdout: "", stderr: "" });

  app = Fastify();
  await app.register((instance: FastifyInstance) => accountRoutes(instance));
  await app.ready();
});

afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
});

// ── GET /api/account/status ──────────────────────────────────────────

describe("GET /api/account/status", () => {
  it("returns ghInstalled=false when gh is not installed", async () => {
    mocks.isGhInstalled.mockResolvedValue(false);

    const res = await app.inject({ method: "GET", url: "/api/account/status" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ghInstalled: false,
      authenticated: false,
      deviceFlowAvailable: false,
    });
  });

  it("returns authenticated=false when gh is installed but not authenticated", async () => {
    mocks.gh.mockRejectedValue(new Error("not logged in"));

    const res = await app.inject({ method: "GET", url: "/api/account/status" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ghInstalled: true,
      authenticated: false,
      deviceFlowAvailable: true,
    });
  });

  it("returns authenticated=true with user data when fully authenticated", async () => {
    // First call: auth status check (succeeds)
    // Second call: gh api user
    mocks.gh
      .mockResolvedValueOnce({ stdout: "", stderr: "" }) // auth status
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          login: "octocat",
          name: "Mona Lisa",
          email: "octocat@github.com",
          avatar_url: "https://avatars.githubusercontent.com/u/1",
        }),
        stderr: "",
      });

    const res = await app.inject({ method: "GET", url: "/api/account/status" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ghInstalled).toBe(true);
    expect(body.authenticated).toBe(true);
    expect(body.user).toEqual({
      login: "octocat",
      name: "Mona Lisa",
      email: "octocat@github.com",
      avatarUrl: "https://avatars.githubusercontent.com/u/1",
    });
  });

  it("returns user=null when authenticated but gh api user fails", async () => {
    mocks.gh
      .mockResolvedValueOnce({ stdout: "", stderr: "" }) // auth status
      .mockRejectedValueOnce(new Error("API error")); // gh api user

    const res = await app.inject({ method: "GET", url: "/api/account/status" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.authenticated).toBe(true);
    expect(body.user).toBeNull();
  });

  it("fills missing user fields with empty strings", async () => {
    mocks.gh
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ login: "bot" }),
        stderr: "",
      });

    const res = await app.inject({ method: "GET", url: "/api/account/status" });

    expect(res.json().user).toEqual({
      login: "bot",
      name: "",
      email: "",
      avatarUrl: "",
    });
  });
});

// ── POST /api/account/connect ────────────────────────────────────────

describe("POST /api/account/connect", () => {
  it("returns 400 when gh is not installed", async () => {
    mocks.isGhInstalled.mockResolvedValue(false);

    const res = await app.inject({ method: "POST", url: "/api/account/connect" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "gh CLI not installed" });
  });

  it("returns 502 when GitHub device code API returns non-2xx", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      text: async () => "rate limited",
    });

    const res = await app.inject({ method: "POST", url: "/api/account/connect" });

    expect(res.statusCode).toBe(502);
    expect(res.json().error).toContain("GitHub API error");
    expect(res.json().error).toContain("rate limited");
  });

  it("returns 400 when GitHub API returns an error field", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        error: "invalid_scope",
        error_description: "One or more scopes are not valid",
      }),
    });

    const res = await app.inject({ method: "POST", url: "/api/account/connect" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "One or more scopes are not valid" });
  });

  it("returns 400 with error code when no description is available", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ error: "bad_request" }),
    });

    const res = await app.inject({ method: "POST", url: "/api/account/connect" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "bad_request" });
  });

  it("returns device code data on successful initiation", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        device_code: "dc-123",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      }),
    });

    const res = await app.inject({ method: "POST", url: "/api/account/connect" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
      expiresIn: 900,
      interval: 5,
    });
  });

  it("sends correct scopes and client_id to GitHub", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        device_code: "dc-1",
        user_code: "CODE",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      }),
    });

    await app.inject({ method: "POST", url: "/api/account/connect" });

    expect(fetchMock).toHaveBeenCalledWith("https://github.com/login/device/code", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: expect.stringContaining("repo workflow read:user user:email read:org"),
    });
  });

  it("requests workflow scope, without which pushes touching .github/workflows are rejected", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        device_code: "dc-1",
        user_code: "CODE",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      }),
    });

    await app.inject({ method: "POST", url: "/api/account/connect" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.scope.split(" ")).toContain("workflow");
    // Repository deletion is not something every operator should have to grant.
    expect(body.scope.split(" ")).not.toContain("delete_repo");
  });

  it("uses GITHUB_CLIENT_ID env var when set", async () => {
    const originalEnv = process.env.GITHUB_CLIENT_ID;
    process.env.GITHUB_CLIENT_ID = "custom-client-id";

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        device_code: "dc-1",
        user_code: "CODE",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      }),
    });

    await app.inject({ method: "POST", url: "/api/account/connect" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.client_id).toBe("custom-client-id");

    if (originalEnv === undefined) {
      delete process.env.GITHUB_CLIENT_ID;
    } else {
      process.env.GITHUB_CLIENT_ID = originalEnv;
    }
  });
});

// ── POST /api/account/connect/poll ───────────────────────────────────

describe("POST /api/account/connect/poll", () => {
  async function initDeviceFlow() {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        device_code: "dc-poll-test",
        user_code: "POLL-CODE",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      }),
    });
    await app.inject({ method: "POST", url: "/api/account/connect" });
    fetchMock.mockReset();
  }

  async function clearPendingFlow() {
    // Clear any module-level pendingDeviceFlow state from prior tests
    // by triggering an expired_token response
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ error: "expired_token" }),
    });
    await app.inject({ method: "POST", url: "/api/account/connect/poll" });
    fetchMock.mockReset();
  }

  it("returns 400 when no pending device flow", async () => {
    await clearPendingFlow();

    const res = await app.inject({ method: "POST", url: "/api/account/connect/poll" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "No pending device flow" });
  });

  it("returns status=pending when authorization_pending", async () => {
    await initDeviceFlow();

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ error: "authorization_pending" }),
    });

    const res = await app.inject({ method: "POST", url: "/api/account/connect/poll" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "pending" });
  });

  it("returns status=slow_down and updates interval", async () => {
    await initDeviceFlow();

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ error: "slow_down", interval: 10 }),
    });

    const res = await app.inject({ method: "POST", url: "/api/account/connect/poll" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "slow_down", interval: 10 });
  });

  it("returns status=expired on expired_token", async () => {
    await initDeviceFlow();

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ error: "expired_token" }),
    });

    const res = await app.inject({ method: "POST", url: "/api/account/connect/poll" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "expired" });

    // Flow should be cleared
    const res2 = await app.inject({ method: "POST", url: "/api/account/connect/poll" });
    expect(res2.statusCode).toBe(400);
  });

  it("returns status=denied on access_denied", async () => {
    await initDeviceFlow();

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ error: "access_denied" }),
    });

    const res = await app.inject({ method: "POST", url: "/api/account/connect/poll" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "denied" });

    // Flow should be cleared
    const res2 = await app.inject({ method: "POST", url: "/api/account/connect/poll" });
    expect(res2.statusCode).toBe(400);
  });

  it("returns 400 for unknown error codes", async () => {
    await initDeviceFlow();

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ error: "unsupported_grant_type" }),
    });

    const res = await app.inject({ method: "POST", url: "/api/account/connect/poll" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "unsupported_grant_type" });
  });

  it("returns 502 when no access_token in success response", async () => {
    await initDeviceFlow();

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({}), // no error, no access_token
    });

    const res = await app.inject({ method: "POST", url: "/api/account/connect/poll" });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: "No access token in response" });
  });

  it("returns status=complete with user on successful token exchange", async () => {
    await initDeviceFlow();

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "gho_token_123" }),
    });

    // Mock loginWithToken (execFile for gh auth login)
    mocks.execFile.mockImplementation(
      (_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
        cb(null);
        return { stdin: { write: vi.fn(), end: vi.fn() } };
      },
    );

    // Mock fetchGitHubUser after login
    mocks.gh.mockResolvedValue({
      stdout: JSON.stringify({
        login: "octocat",
        name: "Mona Lisa",
        email: "octocat@github.com",
        avatar_url: "https://avatars.githubusercontent.com/u/1",
      }),
      stderr: "",
    });

    const res = await app.inject({ method: "POST", url: "/api/account/connect/poll" });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("complete");
    expect(res.json().user.login).toBe("octocat");
    expect(res.json().gitCredentialError).toBeUndefined();
    expect(mocks._resetGhState).toHaveBeenCalled();
    expect(mocks.gh.mock.calls.map((call) => call[0])).toContainEqual(["auth", "setup-git"]);
  });

  it("reports a git credential helper failure instead of swallowing it", async () => {
    await initDeviceFlow();

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "gho_token_123" }),
    });

    mocks.execFile.mockImplementation(
      (_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
        cb(null);
        return { stdin: { write: vi.fn(), end: vi.fn() } };
      },
    );

    mocks.gh.mockImplementation(async (args: string[]) => {
      if (args[0] === "auth" && args[1] === "setup-git") {
        throw Object.assign(new Error("exit 1"), { stderr: "gh: could not write .gitconfig" });
      }
      return { stdout: JSON.stringify({ login: "octocat" }), stderr: "" };
    });

    const res = await app.inject({ method: "POST", url: "/api/account/connect/poll" });

    // The sign-in itself worked, so it is still reported as complete — but the
    // part that did not is named rather than lost.
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("complete");
    expect(res.json().user.login).toBe("octocat");
    expect(res.json().gitCredentialError).toContain("could not write .gitconfig");
  });

  it("returns 500 when loginWithToken fails", async () => {
    await initDeviceFlow();

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "gho_bad_token" }),
    });

    mocks.execFile.mockImplementation(
      (_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
        cb(new Error("auth failed"));
        return { stdin: { write: vi.fn(), end: vi.fn() } };
      },
    );

    const res = await app.inject({ method: "POST", url: "/api/account/connect/poll" });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toContain("auth failed");
  });

  it("returns status=expired when flow has timed out client-side", async () => {
    // Initiate a flow with tiny expires_in
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        device_code: "dc-expired",
        user_code: "EXP-CODE",
        verification_uri: "https://github.com/login/device",
        expires_in: 0, // expires immediately
        interval: 5,
      }),
    });
    await app.inject({ method: "POST", url: "/api/account/connect" });
    fetchMock.mockReset();

    // Wait for expiry (expiresAt = Date.now() + 0 * 1000 = Date.now())
    await new Promise((r) => setTimeout(r, 10));

    const res = await app.inject({ method: "POST", url: "/api/account/connect/poll" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "expired" });
  });
});

// ── POST /api/account/disconnect ─────────────────────────────────────

describe("POST /api/account/disconnect", () => {
  it("disconnects successfully with user login", async () => {
    mocks.gh
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          login: "octocat",
          name: "Mona Lisa",
          email: "",
          avatar_url: "",
        }),
        stderr: "",
      })
      .mockResolvedValueOnce({ stdout: "", stderr: "" }); // gh auth logout

    const res = await app.inject({ method: "POST", url: "/api/account/disconnect" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mocks._resetGhState).toHaveBeenCalled();

    // Verify logout was called with --user flag
    const logoutCall = mocks.gh.mock.calls[1][0];
    expect(logoutCall).toContain("--user");
    expect(logoutCall).toContain("octocat");
  });

  it("disconnects without --user flag when user fetch fails", async () => {
    mocks.gh
      .mockRejectedValueOnce(new Error("API error")) // fetchGitHubUser fails
      .mockResolvedValueOnce({ stdout: "", stderr: "" }); // gh auth logout

    // Since fetchGitHubUser returns null, user?.login is falsy, so --user is not added.
    // But then the second gh call (logout) should still work.
    // Wait — fetchGitHubUser catches errors and returns null.
    // So the code does: const user = null; args = ["auth","logout","--hostname","github.com"];
    // No --user flag appended.

    const res = await app.inject({ method: "POST", url: "/api/account/disconnect" });

    expect(res.statusCode).toBe(200);
    const logoutCall = mocks.gh.mock.calls[1][0];
    expect(logoutCall).not.toContain("--user");
  });

  it("returns 500 when gh auth logout fails", async () => {
    mocks.gh
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ login: "octocat" }),
        stderr: "",
      })
      .mockRejectedValueOnce(new Error("logout failed"));

    const res = await app.inject({ method: "POST", url: "/api/account/disconnect" });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toContain("logout failed");
  });
});
