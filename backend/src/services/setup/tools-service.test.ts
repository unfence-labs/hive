import { describe, expect, it, vi } from "vitest";
import { findToolSpec, installCommand, toolsPrefix } from "./catalog.js";
import type { CommandResult } from "./command.js";
import { ToolOperationError } from "./operations.js";
import {
  getToolsStatus,
  makeToolOperationRunner,
  type ToolsServiceDeps,
} from "./tools-service.js";

function ok(stdout = ""): CommandResult {
  return { stdout, stderr: "", exitCode: 0, timedOut: false };
}

function missing(): CommandResult {
  return { stdout: "", stderr: "command not found", exitCode: 127, timedOut: false };
}

interface Scenario {
  /** Keyed by "<command> <args…>"; anything unlisted answers "not found". */
  probes?: Record<string, CommandResult>;
  installResult?: CommandResult;
  /** Probe results applied after a successful install command. */
  probesAfterInstall?: Record<string, CommandResult>;
  latest?: Record<string, string | null>;
}

function makeDeps(scenario: Scenario = {}) {
  let installed = false;
  const onToolsChanged = vi.fn(async () => {});
  const runInstall = vi.fn();

  const deps: ToolsServiceDeps = {
    prefix: "/home/hive/.local",
    onToolsChanged,
    fetchLatestVersion: async (pkg) => scenario.latest?.[pkg] ?? null,
    run: async (command, args) => {
      const key = [command, ...args].join(" ");
      if (command === "npm") {
        runInstall(key);
        const result = scenario.installResult ?? ok();
        if (result.exitCode === 0) installed = true;
        return result;
      }
      const table =
        installed && scenario.probesAfterInstall
          ? { ...scenario.probes, ...scenario.probesAfterInstall }
          : scenario.probes;
      return table?.[key] ?? missing();
    },
    detect: {
      env: {},
      run: async (command, args) => deps.run(command, args),
    },
  };

  return { deps, onToolsChanged, runInstall };
}

const claude = findToolSpec("claude")!;
const gh = findToolSpec("gh")!;

const noop = { setPhase: () => {} };

describe("getToolsStatus", () => {
  it("reports installed state, version, sign-in and update availability", async () => {
    const { deps } = makeDeps({
      probes: {
        "claude --version": ok("1.0.0"),
        "claude auth status": ok('{"loggedIn":true}'),
        "gh --version": ok("gh version 2.62.0"),
      },
      latest: { "@anthropic-ai/claude-code": "1.1.0", "@openai/codex": "0.9.0" },
    });

    const tools = await getToolsStatus(deps);
    const byId = Object.fromEntries(tools.map((t) => [t.id, t]));

    expect(byId.claude).toEqual({
      id: "claude",
      label: "Claude Code",
      installed: true,
      version: "1.0.0",
      latestVersion: "1.1.0",
      updateAvailable: true,
      authenticated: true,
      managed: true,
    });
    expect(byId.codex).toMatchObject({ installed: false, updateAvailable: false });
    // gh is reported but not managed, and no registry lookup is attempted.
    expect(byId.gh).toMatchObject({
      installed: true,
      version: "2.62.0",
      authenticated: false,
      managed: false,
      latestVersion: null,
      updateAvailable: false,
    });
  });

  it("does not claim an update when the registry could not be reached", async () => {
    const { deps } = makeDeps({ probes: { "claude --version": ok("1.0.0") }, latest: {} });
    const tools = await getToolsStatus(deps);
    expect(tools.find((t) => t.id === "claude")).toMatchObject({
      latestVersion: null,
      updateAvailable: false,
    });
  });

  it("does not claim an update when the installed version is already the latest", async () => {
    const { deps } = makeDeps({
      probes: { "claude --version": ok("1.1.0") },
      latest: { "@anthropic-ai/claude-code": "1.1.0" },
    });
    const tools = await getToolsStatus(deps);
    expect(tools.find((t) => t.id === "claude")?.updateAvailable).toBe(false);
  });
});

describe("install and update", () => {
  it("installs into the service account's prefix, not system-wide", async () => {
    const { deps, runInstall, onToolsChanged } = makeDeps({
      probesAfterInstall: { "claude --version": ok("1.1.0") },
    });

    await makeToolOperationRunner(claude, "install", deps)(noop);

    expect(runInstall).toHaveBeenCalledWith(
      "npm install -g --prefix /home/hive/.local --no-audit --no-fund @anthropic-ai/claude-code@latest",
    );
    expect(onToolsChanged).toHaveBeenCalledOnce();
  });

  it("skips the install when the tool is already there", async () => {
    const { deps, runInstall } = makeDeps({ probes: { "claude --version": ok("1.0.0") } });

    await makeToolOperationRunner(claude, "install", deps)(noop);

    expect(runInstall).not.toHaveBeenCalled();
  });

  it("runs an update even though the tool is already installed", async () => {
    const { deps, runInstall } = makeDeps({ probes: { "claude --version": ok("1.0.0") } });

    await makeToolOperationRunner(claude, "update", deps)(noop);

    expect(runInstall).toHaveBeenCalledOnce();
  });

  it("walks the phases so a client can render progress", async () => {
    const { deps } = makeDeps({ probesAfterInstall: { "claude --version": ok("1.1.0") } });
    const phases: string[] = [];

    await makeToolOperationRunner(claude, "install", deps)({
      setPhase: (phase) => phases.push(phase),
    });

    expect(phases).toEqual(["detecting", "running", "verifying"]);
  });
});

describe("typed failures", () => {
  it("reports an unreachable registry as a network failure with the real output", async () => {
    const { deps } = makeDeps({
      installResult: {
        stdout: "",
        stderr: "npm error code ENOTFOUND\nnpm error syscall getaddrinfo",
        exitCode: 1,
        timedOut: false,
      },
    });

    const error = await makeToolOperationRunner(claude, "install", deps)(noop).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ToolOperationError);
    const failure = error as ToolOperationError;
    expect(failure.reason).toBe("network");
    expect(failure.message).toContain("Claude Code install failed");
    expect(failure.outputExcerpt).toContain("ENOTFOUND");
  });

  it("reports a command that ran and refused as a command failure", async () => {
    const { deps } = makeDeps({
      installResult: {
        stdout: "",
        stderr: "npm error EACCES: permission denied, mkdir '/home/hive/.local/lib'",
        exitCode: 243,
        timedOut: false,
      },
    });

    const failure = (await makeToolOperationRunner(claude, "update", deps)(noop).catch(
      (e: unknown) => e,
    )) as ToolOperationError;

    expect(failure.reason).toBe("command_failed");
    expect(failure.message).toContain("exit 243");
    expect(failure.outputExcerpt).toContain("EACCES");
  });

  it("reports a killed command as a timeout", async () => {
    const { deps } = makeDeps({
      installResult: { stdout: "", stderr: "", exitCode: 1, timedOut: true },
    });

    const failure = (await makeToolOperationRunner(claude, "install", deps)(noop).catch(
      (e: unknown) => e,
    )) as ToolOperationError;

    expect(failure.reason).toBe("timeout");
  });

  it("refuses to call a silent no-op a success when nothing landed on PATH", async () => {
    // The install command exits 0, but the binary still is not there.
    const { deps, onToolsChanged } = makeDeps({ installResult: ok("added 1 package") });

    const failure = (await makeToolOperationRunner(claude, "install", deps)(noop).catch(
      (e: unknown) => e,
    )) as ToolOperationError;

    expect(failure.reason).toBe("not_on_path");
    expect(onToolsChanged).not.toHaveBeenCalled();
  });
});

describe("catalog", () => {
  it("keeps installs inside the service account's home", () => {
    expect(toolsPrefix({ HOME: "/home/hive" })).toBe("/home/hive/.local");
    expect(toolsPrefix({ HOME: "/home/hive", HIVE_TOOLS_DIR: "/opt/hive/tools" })).toBe(
      "/opt/hive/tools",
    );
  });

  it("never builds an install command for an unmanaged tool's package", () => {
    // gh carries no package, so the panel refuses the action upstream; this
    // pins the fact that there is nothing installable to build from.
    expect(gh.npmPackage).toBe("");
    expect(installCommand(claude, "/tmp/p").args).toContain("@anthropic-ai/claude-code@latest");
  });
});
