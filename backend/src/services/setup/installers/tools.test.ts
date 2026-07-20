import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ detectTools: vi.fn() }));
vi.mock("../detect.js", () => ({ detectTools: mocks.detectTools }));

import {
  installGhStep,
  installDockerStep,
  installClaudeStep,
  installCodexStep,
} from "./tools.js";
import type { InstallerDeps, RunCommand } from "./command.js";
import { StepError } from "../operations.js";
import type { EmitFn } from "../operations.js";

/** Typed access to a mocked RunCommand's recorded calls. */
function runCalls(run: RunCommand): Parameters<RunCommand>[] {
  return (run as unknown as ReturnType<typeof vi.fn<RunCommand>>).mock.calls;
}

const lines: string[] = [];
const emit: EmitFn = async ({ line }) => {
  lines.push(line);
};

function okRun(): RunCommand {
  return vi.fn<RunCommand>(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
}

function deps(overrides: Partial<InstallerDeps> = {}): InstallerDeps {
  return {
    run: okRun(),
    helpersAvailable: async () => true,
    helpersDir: "/usr/lib/hive/helpers",
    ...overrides,
  };
}

beforeEach(() => {
  lines.length = 0;
  mocks.detectTools.mockReset();
});

/** detect returns "installed" only after the first probe (guard: not installed). */
function detectInstalledAfterFirst(tool: string) {
  let calls = 0;
  mocks.detectTools.mockImplementation(async () => {
    calls += 1;
    return { [tool]: { installed: calls > 1 } };
  });
}

describe("guard: already installed", () => {
  it("skips install when detect reports installed", async () => {
    mocks.detectTools.mockResolvedValue({ claude: { installed: true } });
    const d = deps();
    const result = await installClaudeStep(d)(emit);
    expect(result).toMatchObject({ skipped: true });
    expect(d.run).not.toHaveBeenCalled();
  });
});

describe("user-space installers run + verify", () => {
  it("claude installs with DISABLE_AUTOUPDATER", async () => {
    detectInstalledAfterFirst("claude");
    const d = deps();
    await installClaudeStep(d)(emit);
    const call = runCalls(d.run)[0];
    expect(call[0]).toContain("claude.ai/install.sh");
    expect(call[1]?.env).toMatchObject({ DISABLE_AUTOUPDATER: "1" });
  });

  it("codex installs into the user npm prefix", async () => {
    detectInstalledAfterFirst("codex");
    const d = deps();
    await installCodexStep(d)(emit);
    expect(runCalls(d.run)[0][0]).toContain('npm install -g --prefix "$HOME/.local" @openai/codex');
  });

  it("fails with NETWORK when the install command exits non-zero", async () => {
    mocks.detectTools.mockResolvedValue({ claude: { installed: false } });
    const d = deps({
      run: vi.fn(async () => ({ stdout: "", stderr: "curl: could not resolve host", exitCode: 6 })),
    });
    await expect(installClaudeStep(d)(emit)).rejects.toMatchObject({ code: "NETWORK" });
  });
});

describe("helper-backed installers", () => {
  it("gh runs the privileged helper on a provisioned server", async () => {
    detectInstalledAfterFirst("gh");
    const run = vi.fn<RunCommand>(async () => ({ stdout: "gh installed", stderr: "", exitCode: 0 }));
    const d = deps({ run });
    await installGhStep(d)(emit);
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0][0]).toContain("sudo /usr/lib/hive/helpers/install-gh.sh");
  });

  it("gh degrades to a logged no-op when helpers are unavailable (off-server)", async () => {
    // Never installed, but degrade path must still succeed (no throw).
    mocks.detectTools.mockResolvedValue({ gh: { installed: false } });
    const run = vi.fn<RunCommand>(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const d = deps({ helpersAvailable: async () => false, run });
    const result = await installGhStep(d)(emit);
    expect(result).toMatchObject({ degraded: true });
    expect(run).not.toHaveBeenCalled();
    expect(lines.some((l) => l.includes("privileged helpers unavailable"))).toBe(true);
  });

  it("docker helper failure raises APT_FAILURE", async () => {
    mocks.detectTools.mockResolvedValue({ docker: { installed: false } });
    const run = vi.fn<RunCommand>(async () => ({ stdout: "", stderr: "dpkg error", exitCode: 100 }));
    const d = deps({ run });
    await expect(installDockerStep(d)(emit)).rejects.toBeInstanceOf(StepError);
    await expect(installDockerStep(d)(emit)).rejects.toMatchObject({ code: "APT_FAILURE" });
  });
});
