import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

// ── Mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  gh: vi.fn(),
  isGhInstalled: vi.fn(),
  _resetGhState: vi.fn(),
}));

vi.mock("../utils/github.js", () => ({
  gh: mocks.gh,
  isGhInstalled: mocks.isGhInstalled,
  _resetGhState: mocks._resetGhState,
}));

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
    expect(res.json()).toEqual({ ghInstalled: false, authenticated: false });
  });

  it("returns authenticated=false when gh is installed but not authenticated", async () => {
    mocks.gh.mockRejectedValue(new Error("not logged in"));

    const res = await app.inject({ method: "GET", url: "/api/account/status" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ghInstalled: true, authenticated: false });
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
