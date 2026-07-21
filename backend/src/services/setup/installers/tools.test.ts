import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  detectTools: vi.fn(),
  detectAvailableProviders: vi.fn(),
}));
vi.mock("../detect.js", () => ({ detectTools: mocks.detectTools }));
vi.mock("../../../agents/providers/registry.js", () => ({
  detectAvailableProviders: mocks.detectAvailableProviders,
}));

import { installClaudeStep, installCodexStep } from "./tools.js";
import type { InstallerDeps, RunCommand } from "./command.js";

const context = { setAction: async () => {} };

function runCalls(run: RunCommand): Parameters<RunCommand>[] {
  return (run as unknown as ReturnType<typeof vi.fn<RunCommand>>).mock.calls;
}

function deps(run: RunCommand = vi.fn(async () => ({
  stdout: "",
  stderr: "",
  exitCode: 0,
}))): InstallerDeps {
  return { run };
}

function detectInstalledAfterFirst(tool: "claude" | "codex"): void {
  let calls = 0;
  mocks.detectTools.mockImplementation(async () => {
    calls += 1;
    return { [tool]: { installed: calls > 1, authenticated: false } };
  });
}

beforeEach(() => {
  mocks.detectTools.mockReset();
  mocks.detectAvailableProviders.mockReset();
});

describe("user-space setup installers", () => {
  it("skips an already installed tool", async () => {
    mocks.detectTools.mockResolvedValue({ claude: { installed: true, authenticated: false } });
    const installerDeps = deps();
    await installClaudeStep(installerDeps)(context);
    expect(installerDeps.run).not.toHaveBeenCalled();
  });

  it("installs Claude with auto-update disabled and verifies it", async () => {
    detectInstalledAfterFirst("claude");
    const installerDeps = deps();
    await installClaudeStep(installerDeps)(context);

    expect(runCalls(installerDeps.run)[0][0]).toContain("claude.ai/install.sh");
    expect(runCalls(installerDeps.run)[0][1]?.env).toEqual({ DISABLE_AUTOUPDATER: "1" });
    expect(mocks.detectAvailableProviders).toHaveBeenCalledOnce();
  });

  it("installs Codex in the user prefix", async () => {
    detectInstalledAfterFirst("codex");
    const installerDeps = deps();
    await installCodexStep(installerDeps)(context);
    expect(runCalls(installerDeps.run)[0][0]).toContain(
      'npm install -g --prefix "$HOME/.local" @openai/codex',
    );
  });

  it("surfaces command diagnostics on failure", async () => {
    mocks.detectTools.mockResolvedValue({ claude: { installed: false, authenticated: false } });
    const installerDeps = deps(vi.fn(async () => ({
      stdout: "",
      stderr: "curl: could not resolve host",
      exitCode: 6,
    })));

    await expect(installClaudeStep(installerDeps)(context)).rejects.toMatchObject({
      code: "NETWORK",
      detail: "curl: could not resolve host",
    });
  });

  it("does not blame the network for non-network install failures", async () => {
    mocks.detectTools.mockResolvedValue({ claude: { installed: false, authenticated: false } });
    const installerDeps = deps(vi.fn(async () => ({
      stdout: "",
      stderr: "tar: cannot write: No space left on device",
      exitCode: 2,
    })));

    await expect(installClaudeStep(installerDeps)(context)).rejects.toMatchObject({
      code: "UNKNOWN",
      detail: "tar: cannot write: No space left on device",
    });
  });

  it("fails when a successful command did not install the executable", async () => {
    mocks.detectTools.mockResolvedValue({ claude: { installed: false, authenticated: false } });
    await expect(installClaudeStep(deps())(context)).rejects.toMatchObject({
      code: "UNKNOWN",
      message: "Claude Code did not resolve after install",
    });
  });
});
