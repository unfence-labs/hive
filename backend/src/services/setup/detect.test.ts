import { describe, expect, it, vi } from "vitest";
import { findToolSpec } from "./catalog.js";
import type { CommandResult, RunCommand } from "./command.js";
import { detectTool, type DetectDeps } from "./detect.js";

function ok(stdout: string, stderr = ""): CommandResult {
  return { stdout, stderr, exitCode: 0, timedOut: false };
}

function fail(stderr = "not found"): CommandResult {
  return { stdout: "", stderr, exitCode: 127, timedOut: false };
}

/** Route a probe to a canned result keyed by "<command> <args…>". */
function deps(responses: Record<string, CommandResult>) {
  const run = vi.fn<RunCommand>(
    async (command, args) => responses[[command, ...args].join(" ")] ?? fail(),
  );
  return { run } satisfies DetectDeps;
}

const claude = findToolSpec("claude");
const gh = findToolSpec("gh");

describe("detectTool", () => {
  it("reports the installed version parsed from --version", async () => {
    const detection = await detectTool(
      claude,
      deps({
        "claude --version": ok("1.2.34 (Claude Code)"),
        "claude auth status": ok('{"loggedIn":true}'),
      }),
    );
    expect(detection).toEqual({ installed: true, version: "1.2.34", authenticated: true });
  });

  it("reports a missing tool without probing its authentication", async () => {
    const d = deps({});
    const detection = await detectTool(claude, d);

    expect(detection).toEqual({ installed: false, version: null, authenticated: false });
    expect(d.run).toHaveBeenCalledTimes(1);
    expect(d.run).toHaveBeenCalledWith("claude", ["--version"], expect.anything());
  });

  it("reports installed with a null version when the output has no version in it", async () => {
    const detection = await detectTool(
      claude,
      deps({ "claude --version": ok("some banner with no numbers") }),
    );
    expect(detection).toMatchObject({ installed: true, version: null });
  });

  it("does not treat an inherited OAuth token as a saved sign-in", async () => {
    const d = deps({
      "claude --version": ok("1.0.0"),
      "claude auth status": ok('{"loggedIn":false}'),
    });
    const detection = await detectTool(claude, d);

    expect(detection.authenticated).toBe(false);
    expect(d.run).toHaveBeenCalledWith(
      "claude",
      ["auth", "status"],
      expect.objectContaining({ env: expect.any(Object) }),
    );
  });

  it("fails closed when the Claude auth probe returns something unparseable", async () => {
    const detection = await detectTool(
      claude,
      deps({
        "claude --version": ok("1.0.0"),
        "claude auth status": ok("<html>login required</html>"),
      }),
    );
    expect(detection.authenticated).toBe(false);
  });

  it("fails closed when Claude reports loggedIn false", async () => {
    const detection = await detectTool(
      claude,
      deps({
        "claude --version": ok("1.0.0"),
        "claude auth status": ok('{"loggedIn":false}'),
      }),
    );
    expect(detection.authenticated).toBe(false);
  });

  it("does not read Codex's 'Not logged in' as a sign-in", async () => {
    const codex = findToolSpec("codex")!;
    const detection = await detectTool(
      codex,
      deps({
        "codex --version": ok("codex-cli 0.50.0"),
        "codex login status": ok("Not logged in"),
      }),
    );
    expect(detection).toMatchObject({ installed: true, version: "0.50.0", authenticated: false });
  });

  it("reads Codex's 'Logged in' as a sign-in", async () => {
    const codex = findToolSpec("codex")!;
    const detection = await detectTool(
      codex,
      deps({
        "codex --version": ok("0.50.0"),
        "codex login status": ok("Logged in using ChatGPT"),
      }),
    );
    expect(detection.authenticated).toBe(true);
  });

  it("uses the exit status of gh auth status", async () => {
    const signedIn = await detectTool(
      gh,
      deps({ "gh --version": ok("gh version 2.62.0"), "gh auth status": ok("Logged in") }),
    );
    expect(signedIn).toEqual({ installed: true, version: "2.62.0", authenticated: true });

    const signedOut = await detectTool(
      gh,
      deps({ "gh --version": ok("gh version 2.62.0") }),
    );
    expect(signedOut.authenticated).toBe(false);
  });
});
